use std::{
    collections::{HashMap, VecDeque},
    future::Future,
    pin::Pin,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use async_trait::async_trait;
use time::OffsetDateTime;
use tokio::task::JoinHandle;
use tokio::{sync::Notify, time::timeout};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::protocol::{VoiceId, validate_synthesis_text};

pub const MAX_GLOBAL_QUEUED: usize = 10;
pub const MAX_PAIRING_QUEUED: usize = 3;
pub const WORKER_READY_TIMEOUT: Duration = Duration::from_secs(120);
pub const SYNTHESIS_TIMEOUT: Duration = Duration::from_secs(300);
pub const CANCEL_GRACE: Duration = Duration::from_secs(2);
pub const MAX_WAV_BYTES: usize = 64 * 1024 * 1024;
pub const AUDIO_TTL: Duration = Duration::from_secs(30 * 60);
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(5 * 60);
pub const FUTURE_WORKER_IDLE_STOP: Duration = Duration::from_secs(5 * 60);
pub const METADATA_RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);

pub trait Clock: Send + Sync {
    fn monotonic(&self) -> Instant;
    fn utc(&self) -> OffsetDateTime;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn monotonic(&self) -> Instant {
        Instant::now()
    }

    fn utc(&self) -> OffsetDateTime {
        OffsetDateTime::now_utc()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ExecutorError {
    #[error("the executor is unavailable")]
    Unavailable,
    #[error("the executor crashed")]
    Crash,
    #[error("the executor returned invalid audio")]
    InvalidAudio,
}

pub struct SynthesisTask {
    pub id: Uuid,
    pub pairing_id: Uuid,
    pub voice_id: VoiceId,
    pub text: Zeroizing<String>,
}

#[async_trait]
pub trait SynthesisExecutor: Send + Sync {
    fn is_available(&self) -> bool {
        true
    }

    async fn ready(&self, task: &SynthesisTask) -> Result<(), ExecutorError>;
    async fn synthesize(&self, task: &SynthesisTask) -> Result<Vec<u8>, ExecutorError>;
    async fn cancel(&self, id: Uuid);
}

pub struct UnavailableExecutor;

impl Default for UnavailableExecutor {
    fn default() -> Self {
        Self::new()
    }
}

impl UnavailableExecutor {
    pub const fn new() -> Self {
        Self
    }
}

#[async_trait]
impl SynthesisExecutor for UnavailableExecutor {
    fn is_available(&self) -> bool {
        false
    }

    async fn ready(&self, _task: &SynthesisTask) -> Result<(), ExecutorError> {
        Err(ExecutorError::Unavailable)
    }

    async fn synthesize(&self, _task: &SynthesisTask) -> Result<Vec<u8>, ExecutorError> {
        Err(ExecutorError::Unavailable)
    }

    async fn cancel(&self, _id: Uuid) {}
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobState {
    Queued,
    Starting,
    Synthesizing,
    Completed,
    Cancelling,
    Cancelled,
    Failed,
    Expired,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobSnapshot {
    pub id: Uuid,
    pub pairing_id: Uuid,
    pub voice_id: VoiceId,
    pub state: JobState,
    pub audio_available: bool,
    pub created_at: OffsetDateTime,
    pub finished_at: Option<OffsetDateTime>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum JobError {
    #[error("the job was not found")]
    NotFound,
    #[error("the job is not in a compatible state")]
    Conflict,
    #[error("the global queue is full")]
    QueueFull,
    #[error("the pairing queue is full")]
    PairingQueueFull,
    #[error("completed audio expired")]
    Expired,
    #[error("the synthesis runtime is unavailable")]
    RuntimeUnavailable,
    #[error("the synthesis text is invalid")]
    InvalidText,
    #[error("the scheduler is shutting down")]
    ShuttingDown,
}

struct JobEntry {
    task: SynthesisTask,
    state: JobState,
    generation: u64,
    created_at: OffsetDateTime,
    finished_at: Option<OffsetDateTime>,
    audio: Option<Vec<u8>>,
    audio_expires: Option<Instant>,
    metadata_expires: Option<Instant>,
}

struct ActiveJob {
    id: Uuid,
    generation: u64,
    cancellation: Arc<Cancellation>,
}

#[derive(Default)]
struct Cancellation {
    cancelled: AtomicBool,
    notify: Notify,
}

impl Cancellation {
    fn cancel(&self) {
        if !self.cancelled.swap(true, Ordering::SeqCst) {
            self.notify.notify_waiters();
        }
    }

    async fn cancelled(&self) {
        let notified = self.notify.notified();
        if self.cancelled.load(Ordering::SeqCst) {
            return;
        }
        notified.await;
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

struct SchedulerState {
    jobs: HashMap<Uuid, JobEntry>,
    queues: HashMap<Uuid, VecDeque<Uuid>>,
    rotation: VecDeque<Uuid>,
    queued: usize,
    active: Option<ActiveJob>,
    next_generation: u64,
    last_pairing: Option<Uuid>,
}

struct SchedulerCore {
    state: Mutex<SchedulerState>,
    executor: Arc<dyn SynthesisExecutor>,
    clock: Arc<dyn Clock>,
    work: Notify,
    idle: Notify,
    shutdown: AtomicBool,
    owners: AtomicUsize,
    worker: Mutex<Option<JoinHandle<()>>>,
}

struct AbortOnDropExecution(JoinHandle<()>);

impl AbortOnDropExecution {
    fn new(handle: JoinHandle<()>) -> Self {
        Self(handle)
    }

    async fn join(&mut self) -> Result<(), tokio::task::JoinError> {
        (&mut self.0).await
    }
}

impl Drop for AbortOnDropExecution {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn cancel_executor_until(
    core: &Arc<SchedulerCore>,
    id: Uuid,
    deadline: tokio::time::Instant,
) -> bool {
    let executor = Arc::clone(&core.executor);
    let mut cancellation = AbortOnDropExecution::new(tokio::spawn(async move {
        executor.cancel(id).await;
    }));
    matches!(
        tokio::time::timeout_at(deadline, cancellation.join()).await,
        Ok(Ok(()))
    )
}

async fn cancel_executor(core: &Arc<SchedulerCore>, id: Uuid) {
    let _ = cancel_executor_until(core, id, tokio::time::Instant::now() + CANCEL_GRACE).await;
}

async fn cancel_and_drain<F>(core: &Arc<SchedulerCore>, id: Uuid, stale: Pin<&mut F>)
where
    F: Future,
{
    let deadline = tokio::time::Instant::now() + CANCEL_GRACE;
    if cancel_executor_until(core, id, deadline).await {
        let _ = tokio::time::timeout_at(deadline, stale).await;
    }
}

pub struct Scheduler {
    core: Arc<SchedulerCore>,
}

impl Clone for Scheduler {
    fn clone(&self) -> Self {
        self.core.owners.fetch_add(1, Ordering::SeqCst);
        Self {
            core: Arc::clone(&self.core),
        }
    }
}

impl Drop for Scheduler {
    fn drop(&mut self) {
        if self.core.owners.fetch_sub(1, Ordering::SeqCst) == 1 {
            signal_shutdown(&self.core);
        }
    }
}

impl Scheduler {
    pub fn new<E: SynthesisExecutor + 'static, C: Clock + 'static>(
        executor: Arc<E>,
        clock: Arc<C>,
    ) -> Self {
        let core = Arc::new(SchedulerCore {
            state: Mutex::new(SchedulerState {
                jobs: HashMap::new(),
                queues: HashMap::new(),
                rotation: VecDeque::new(),
                queued: 0,
                active: None,
                next_generation: 0,
                last_pairing: None,
            }),
            executor,
            clock,
            work: Notify::new(),
            idle: Notify::new(),
            shutdown: AtomicBool::new(false),
            owners: AtomicUsize::new(1),
            worker: Mutex::new(None),
        });
        let worker = tokio::spawn(worker_loop(Arc::clone(&core)));
        *core.worker.lock().expect("new scheduler worker lock") = Some(worker);
        Self { core }
    }

    pub fn enqueue(
        &self,
        pairing_id: Uuid,
        voice_id: VoiceId,
        text: String,
    ) -> Result<Uuid, JobError> {
        let text = Zeroizing::new(text);
        if self.core.shutdown.load(Ordering::SeqCst) {
            return Err(JobError::ShuttingDown);
        }
        if !self.core.executor.is_available() {
            return Err(JobError::RuntimeUnavailable);
        }
        validate_synthesis_text(&text).map_err(|_| JobError::InvalidText)?;
        let mut state = self.core.state.lock().map_err(|_| JobError::Conflict)?;
        if state.queued >= MAX_GLOBAL_QUEUED {
            return Err(JobError::QueueFull);
        }
        let pairing_queue_len = state.queues.get(&pairing_id).map_or(0, VecDeque::len);
        if pairing_queue_len >= MAX_PAIRING_QUEUED {
            return Err(JobError::PairingQueueFull);
        }
        let id = Uuid::new_v4();
        state.jobs.insert(
            id,
            JobEntry {
                task: SynthesisTask {
                    id,
                    pairing_id,
                    voice_id,
                    text,
                },
                state: JobState::Queued,
                generation: 0,
                created_at: self.core.clock.utc(),
                finished_at: None,
                audio: None,
                audio_expires: None,
                metadata_expires: None,
            },
        );
        let queue = state.queues.entry(pairing_id).or_default();
        let was_empty = queue.is_empty();
        queue.push_back(id);
        if was_empty {
            state.rotation.push_back(pairing_id);
        }
        state.queued += 1;
        drop(state);
        self.core.work.notify_one();
        Ok(id)
    }

    pub async fn shutdown(&self) {
        signal_shutdown(&self.core);
        let worker = self
            .core
            .worker
            .lock()
            .ok()
            .and_then(|mut worker| worker.take());
        if let Some(mut worker) = worker
            && timeout(CANCEL_GRACE, &mut worker).await.is_err()
        {
            worker.abort();
            let _ = worker.await;
        }
        if let Ok(mut state) = self.core.state.lock() {
            state.jobs.clear();
            state.queues.clear();
            state.rotation.clear();
            state.queued = 0;
            state.active = None;
        }
        self.core.idle.notify_waiters();
    }

    pub fn get(&self, pairing_id: Uuid, id: Uuid) -> Result<JobSnapshot, JobError> {
        let state = self.core.state.lock().map_err(|_| JobError::Conflict)?;
        let job = state
            .jobs
            .get(&id)
            .filter(|job| job.task.pairing_id == pairing_id)
            .ok_or(JobError::NotFound)?;
        Ok(snapshot(job, self.core.clock.monotonic()))
    }

    pub fn audio(&self, pairing_id: Uuid, id: Uuid) -> Result<Vec<u8>, JobError> {
        let state = self.core.state.lock().map_err(|_| JobError::Conflict)?;
        let job = state
            .jobs
            .get(&id)
            .filter(|job| job.task.pairing_id == pairing_id)
            .ok_or(JobError::NotFound)?;
        if job.state != JobState::Completed {
            return Err(JobError::Conflict);
        }
        if job
            .audio_expires
            .is_some_and(|expires| self.core.clock.monotonic() >= expires)
        {
            return Err(JobError::Expired);
        }
        job.audio.clone().ok_or(JobError::Expired)
    }

    pub fn cancel(&self, pairing_id: Uuid, id: Uuid) -> Result<(), JobError> {
        let mut state = self.core.state.lock().map_err(|_| JobError::Conflict)?;
        let owner_matches = state
            .jobs
            .get(&id)
            .is_some_and(|job| job.task.pairing_id == pairing_id);
        if !owner_matches {
            return Err(JobError::NotFound);
        }
        if let Some(active) = &state.active
            && active.id == id
        {
            active.cancellation.cancel();
            if let Some(job) = state.jobs.get_mut(&id)
                && !matches!(
                    job.state,
                    JobState::Cancelled | JobState::Failed | JobState::Completed
                )
            {
                job.state = JobState::Cancelling;
            }
            return Ok(());
        }
        let job_state = state.jobs.get(&id).map(|job| job.state);
        if job_state == Some(JobState::Queued) {
            remove_queued(&mut state, pairing_id, id);
            let finished = self.core.clock.utc();
            let metadata_expires = self.core.clock.monotonic() + METADATA_RETENTION;
            if let Some(job) = state.jobs.get_mut(&id) {
                drop(std::mem::take(&mut job.task.text));
                job.state = JobState::Cancelled;
                job.finished_at = Some(finished.max(job.created_at));
                job.metadata_expires = Some(metadata_expires);
            }
        }
        Ok(())
    }

    pub async fn wait_idle(&self) {
        loop {
            let notified = self.core.idle.notified();
            let idle = self
                .core
                .state
                .lock()
                .map(|state| state.active.is_none() && state.queued == 0)
                .unwrap_or(true);
            if idle {
                return;
            }
            notified.await;
        }
    }

    pub fn sweep(&self) {
        sweep_core(&self.core);
    }
}

fn sweep_core(core: &SchedulerCore) {
    let monotonic = core.clock.monotonic();
    if let Ok(mut state) = core.state.lock() {
        for job in state.jobs.values_mut() {
            if job
                .audio_expires
                .is_some_and(|expires| monotonic >= expires)
            {
                job.audio = None;
                job.audio_expires = None;
            }
        }
        state.jobs.retain(|_, job| {
            !matches!(
                job.state,
                JobState::Completed | JobState::Cancelled | JobState::Failed | JobState::Expired
            ) || job
                .metadata_expires
                .is_none_or(|expires| monotonic < expires)
        });
    }
}

fn snapshot(job: &JobEntry, monotonic: Instant) -> JobSnapshot {
    JobSnapshot {
        id: job.task.id,
        pairing_id: job.task.pairing_id,
        voice_id: job.task.voice_id,
        state: job.state,
        audio_available: job.audio.is_some()
            && job.audio_expires.is_some_and(|expires| monotonic < expires),
        created_at: job.created_at,
        finished_at: job.finished_at,
    }
}

fn remove_queued(state: &mut SchedulerState, pairing_id: Uuid, id: Uuid) {
    if let Some(queue) = state.queues.get_mut(&pairing_id)
        && let Some(position) = queue.iter().position(|candidate| *candidate == id)
    {
        queue.remove(position);
        state.queued = state.queued.saturating_sub(1);
        if queue.is_empty() {
            state.queues.remove(&pairing_id);
            state.rotation.retain(|candidate| *candidate != pairing_id);
        }
    }
}

async fn worker_loop(core: Arc<SchedulerCore>) {
    let first_sweep = tokio::time::Instant::now() + SWEEP_INTERVAL;
    let mut sweep = tokio::time::interval_at(first_sweep, SWEEP_INTERVAL);
    sweep.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        if core.shutdown.load(Ordering::SeqCst) {
            break;
        }
        if let Some((task, generation, cancellation)) = take_next(&core) {
            let id = task.id;
            let execution_core = Arc::clone(&core);
            let mut execution = AbortOnDropExecution::new(tokio::spawn(async move {
                process_job(&execution_core, task, generation, cancellation).await;
            }));
            let execution_result = loop {
                tokio::select! {
                    result = execution.join() => break result,
                    _ = sweep.tick() => sweep_core(&core),
                }
            };
            if execution_result.is_err() {
                cancel_executor(&core, id).await;
                finish(&core, id, generation, JobState::Failed, None);
            }
            if core.shutdown.load(Ordering::SeqCst) {
                break;
            }
            continue;
        }
        core.idle.notify_waiters();
        tokio::select! {
            () = core.work.notified() => {}
            _ = sweep.tick() => sweep_core(&core),
        }
    }
}

fn signal_shutdown(core: &Arc<SchedulerCore>) {
    if !core.shutdown.swap(true, Ordering::SeqCst) {
        if let Ok(mut state) = core.state.lock() {
            if let Some(active) = &state.active {
                active.cancellation.cancel();
            }
            state.jobs.clear();
            state.queues.clear();
            state.rotation.clear();
            state.queued = 0;
        }
        core.work.notify_one();
        core.idle.notify_waiters();
    }
}

fn take_next(core: &Arc<SchedulerCore>) -> Option<(SynthesisTask, u64, Arc<Cancellation>)> {
    let mut state = core.state.lock().ok()?;
    if state.active.is_some() || state.queued == 0 {
        return None;
    }
    if state.rotation.len() > 1
        && state.rotation.front() == state.last_pairing.as_ref()
        && let Some(pairing) = state.rotation.pop_front()
    {
        state.rotation.push_back(pairing);
    }
    let pairing_id = state.rotation.pop_front()?;
    let queue = state.queues.get_mut(&pairing_id)?;
    let id = queue.pop_front()?;
    if queue.is_empty() {
        state.queues.remove(&pairing_id);
    } else {
        state.rotation.push_back(pairing_id);
    }
    state.queued = state.queued.saturating_sub(1);
    state.next_generation = state.next_generation.wrapping_add(1);
    let generation = state.next_generation;
    let cancellation = Arc::new(Cancellation::default());
    let job = state.jobs.get_mut(&id)?;
    job.state = JobState::Starting;
    job.generation = generation;
    let task = SynthesisTask {
        id: job.task.id,
        pairing_id: job.task.pairing_id,
        voice_id: job.task.voice_id,
        text: std::mem::take(&mut job.task.text),
    };
    state.active = Some(ActiveJob {
        id,
        generation,
        cancellation: Arc::clone(&cancellation),
    });
    state.last_pairing = Some(pairing_id);
    Some((task, generation, cancellation))
}

async fn process_job(
    core: &Arc<SchedulerCore>,
    task: SynthesisTask,
    generation: u64,
    cancellation: Arc<Cancellation>,
) {
    let ready = core.executor.ready(&task);
    tokio::pin!(ready);
    let ready_result = tokio::select! {
        biased;
        _ = cancellation.cancelled() => {
            cancel_executor(core, task.id).await;
            finish(core, task.id, generation, JobState::Cancelled, None);
            return;
        }
        result = timeout(WORKER_READY_TIMEOUT, &mut ready) => result,
    };
    if !matches!(ready_result, Ok(Ok(()))) {
        cancel_executor(core, task.id).await;
        finish(core, task.id, generation, JobState::Failed, None);
        return;
    }
    if let Ok(mut state) = core.state.lock()
        && let Some(job) = state.jobs.get_mut(&task.id)
        && job.generation == generation
    {
        job.state = JobState::Synthesizing;
    }

    let synthesis = core.executor.synthesize(&task);
    tokio::pin!(synthesis);
    enum Outcome {
        Result(Result<Vec<u8>, ExecutorError>),
        Cancel,
        Timeout,
    }
    let outcome = tokio::select! {
        biased;
        _ = cancellation.cancelled() => Outcome::Cancel,
        result = &mut synthesis => Outcome::Result(result),
        _ = tokio::time::sleep(SYNTHESIS_TIMEOUT) => Outcome::Timeout,
    };
    match outcome {
        Outcome::Cancel => {
            cancel_and_drain(core, task.id, synthesis.as_mut()).await;
            finish(core, task.id, generation, JobState::Cancelled, None);
        }
        Outcome::Timeout => {
            cancel_and_drain(core, task.id, synthesis.as_mut()).await;
            finish(core, task.id, generation, JobState::Failed, None);
        }
        Outcome::Result(Ok(wav)) if valid_wav(&wav) => {
            finish(core, task.id, generation, JobState::Completed, Some(wav));
        }
        Outcome::Result(Ok(_)) | Outcome::Result(Err(_)) => {
            finish(core, task.id, generation, JobState::Failed, None);
        }
    }
}

fn valid_wav(wav: &[u8]) -> bool {
    valid_wav_with_limit(wav, MAX_WAV_BYTES)
}

fn valid_wav_with_limit(wav: &[u8], max_bytes: usize) -> bool {
    if wav.len() < 44 || wav.len() > max_bytes || &wav[..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return false;
    }
    let riff_size = u32::from_le_bytes(wav[4..8].try_into().expect("four byte RIFF size"));
    if usize::try_from(riff_size)
        .ok()
        .and_then(|size| size.checked_add(8))
        != Some(wav.len())
    {
        return false;
    }

    let mut offset = 12_usize;
    let mut has_format = false;
    let mut has_data = false;
    while offset.checked_add(8).is_some_and(|end| end <= wav.len()) {
        let id = &wav[offset..offset + 4];
        let size = u32::from_le_bytes(
            wav[offset + 4..offset + 8]
                .try_into()
                .expect("four byte chunk size"),
        ) as usize;
        let data_start = offset + 8;
        let Some(data_end) = data_start.checked_add(size) else {
            return false;
        };
        if data_end > wav.len() {
            return false;
        }
        if id == b"fmt " {
            if has_format || size != 16 {
                return false;
            }
            let format = u16::from_le_bytes(wav[data_start..data_start + 2].try_into().unwrap());
            let channels =
                u16::from_le_bytes(wav[data_start + 2..data_start + 4].try_into().unwrap());
            let sample_rate =
                u32::from_le_bytes(wav[data_start + 4..data_start + 8].try_into().unwrap());
            let byte_rate =
                u32::from_le_bytes(wav[data_start + 8..data_start + 12].try_into().unwrap());
            let block_align =
                u16::from_le_bytes(wav[data_start + 12..data_start + 14].try_into().unwrap());
            let bits =
                u16::from_le_bytes(wav[data_start + 14..data_start + 16].try_into().unwrap());
            if format != 1
                || channels != 1
                || sample_rate != 24_000
                || byte_rate != 48_000
                || block_align != 2
                || bits != 16
            {
                return false;
            }
            has_format = true;
        } else if id == b"data" {
            if has_data || size == 0 || !size.is_multiple_of(2) {
                return false;
            }
            has_data = true;
        }
        let Some(next) = data_end.checked_add(size % 2) else {
            return false;
        };
        if next > wav.len() {
            return false;
        }
        offset = next;
    }
    offset == wav.len() && has_format && has_data
}

fn finish(
    core: &Arc<SchedulerCore>,
    id: Uuid,
    generation: u64,
    state_value: JobState,
    audio: Option<Vec<u8>>,
) {
    if let Ok(mut state) = core.state.lock() {
        let current = state
            .active
            .as_ref()
            .is_some_and(|active| active.id == id && active.generation == generation);
        if !current {
            return;
        }
        let was_cancelled = state
            .active
            .as_ref()
            .is_some_and(|active| active.cancellation.is_cancelled());
        let (state_value, audio) = if was_cancelled {
            (JobState::Cancelled, None)
        } else {
            (state_value, audio)
        };
        let finished_at = core.clock.utc();
        let finished_monotonic = core.clock.monotonic();
        let audio_expires = audio.as_ref().map(|_| finished_monotonic + AUDIO_TTL);
        let metadata_expires = Some(finished_monotonic + METADATA_RETENTION);
        if let Some(job) = state.jobs.get_mut(&id)
            && job.generation == generation
        {
            job.state = state_value;
            job.audio = audio;
            job.audio_expires = audio_expires;
            job.finished_at = Some(finished_at.max(job.created_at));
            job.metadata_expires = metadata_expires;
        }
        state.active = None;
    }
    core.work.notify_one();
    core.idle.notify_waiters();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav_with_chunks(chunks: &[(&[u8; 4], Vec<u8>)]) -> Vec<u8> {
        let mut wav = Vec::from(&b"RIFF\0\0\0\0WAVE"[..]);
        for (id, data) in chunks {
            wav.extend_from_slice(*id);
            wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
            wav.extend_from_slice(data);
            if data.len() % 2 == 1 {
                wav.push(0);
            }
        }
        let riff_size = (wav.len() - 8) as u32;
        wav[4..8].copy_from_slice(&riff_size.to_le_bytes());
        wav
    }

    fn pcm_format_chunk() -> Vec<u8> {
        Vec::from(&b"\x01\0\x01\0\xc0\x5d\0\0\x80\xbb\0\0\x02\0\x10\0"[..])
    }

    struct FixedClock;

    impl Clock for FixedClock {
        fn monotonic(&self) -> Instant {
            Instant::now()
        }

        fn utc(&self) -> OffsetDateTime {
            OffsetDateTime::UNIX_EPOCH
        }
    }

    struct ImmediateExecutor;

    #[async_trait]
    impl SynthesisExecutor for ImmediateExecutor {
        async fn ready(&self, _task: &SynthesisTask) -> Result<(), ExecutorError> {
            Ok(())
        }

        async fn synthesize(&self, _task: &SynthesisTask) -> Result<Vec<u8>, ExecutorError> {
            let mut wav = Vec::from(&b"RIFF\x26\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0\xc0\x5d\0\0\x80\xbb\0\0\x02\0\x10\0data\x02\0\0\0\0\0"[..]);
            wav.shrink_to_fit();
            Ok(wav)
        }

        async fn cancel(&self, _id: Uuid) {}
    }

    #[tokio::test]
    async fn completed_job_retains_no_synthesis_text() {
        let scheduler = Scheduler::new(Arc::new(ImmediateExecutor), Arc::new(FixedClock));
        let id = scheduler
            .enqueue(
                Uuid::new_v4(),
                VoiceId::parse("pocket:alba").unwrap(),
                "secret text".into(),
            )
            .unwrap();
        scheduler.wait_idle().await;

        let state = scheduler.core.state.lock().unwrap();
        assert!(state.jobs.get(&id).unwrap().task.text.is_empty());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn cancelled_queued_job_retains_metadata_only() {
        let scheduler = Scheduler::new(Arc::new(ImmediateExecutor), Arc::new(FixedClock));
        let owner = Uuid::new_v4();
        let id = scheduler
            .enqueue(
                owner,
                VoiceId::parse("pocket:alba").unwrap(),
                "cancelled secret text".into(),
            )
            .unwrap();

        scheduler.cancel(owner, id).unwrap();

        let state = scheduler.core.state.lock().unwrap();
        let job = state.jobs.get(&id).unwrap();
        assert_eq!(job.state, JobState::Cancelled);
        assert!(job.task.text.is_empty());
    }

    #[test]
    fn wav_requires_one_format_chunk_and_one_nonempty_data_chunk() {
        let format = pcm_format_chunk();
        let valid = wav_with_chunks(&[(b"fmt ", format.clone()), (b"data", vec![0, 0])]);
        assert!(valid_wav(&valid));
        assert!(!valid_wav(&wav_with_chunks(&[
            (b"fmt ", format.clone()),
            (b"data", Vec::new()),
        ])));
        assert!(!valid_wav(&wav_with_chunks(&[
            (b"fmt ", format.clone()),
            (b"fmt ", format.clone()),
            (b"data", vec![0, 0]),
        ])));
        assert!(!valid_wav(&wav_with_chunks(&[
            (b"fmt ", format),
            (b"data", vec![0, 0]),
            (b"data", vec![0, 0]),
        ])));

        let mut out_of_bounds = valid.clone();
        out_of_bounds[40..44].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(!valid_wav(&out_of_bounds));

        let mut partial_trailing_header = valid;
        partial_trailing_header.push(0);
        let riff_size = (partial_trailing_header.len() - 8) as u32;
        partial_trailing_header[4..8].copy_from_slice(&riff_size.to_le_bytes());
        assert!(!valid_wav(&partial_trailing_header));
    }

    #[test]
    fn wav_size_limit_is_inclusive_without_allocating_a_giant_fixture() {
        let wav = wav_with_chunks(&[(b"fmt ", pcm_format_chunk()), (b"data", vec![0, 0])]);
        assert!(valid_wav_with_limit(&wav, wav.len()));
        assert!(!valid_wav_with_limit(&wav, wav.len() - 1));
    }
}
