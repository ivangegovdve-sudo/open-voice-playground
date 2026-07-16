use std::{
    collections::VecDeque,
    future::pending,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use async_trait::async_trait;
use open_voice_companion::{
    protocol::VoiceId,
    scheduler::{
        AUDIO_TTL, CANCEL_GRACE, Clock, ExecutorError, JobError, JobState, METADATA_RETENTION,
        SWEEP_INTERVAL, SYNTHESIS_TIMEOUT, Scheduler, SynthesisExecutor, SynthesisTask,
        UnavailableExecutor, WORKER_READY_TIMEOUT,
    },
};
use time::OffsetDateTime;
use tokio::sync::{Semaphore, mpsc};
use uuid::Uuid;

#[derive(Clone)]
struct ManualClock {
    state: Arc<Mutex<(Instant, OffsetDateTime)>>,
}

impl ManualClock {
    fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new((Instant::now(), OffsetDateTime::UNIX_EPOCH))),
        }
    }

    fn advance(&self, duration: Duration) {
        let mut state = self.state.lock().unwrap();
        state.0 += duration;
        state.1 += time::Duration::try_from(duration).unwrap();
    }

    fn set_utc(&self, utc: OffsetDateTime) {
        self.state.lock().unwrap().1 = utc;
    }
}

impl Clock for ManualClock {
    fn monotonic(&self) -> Instant {
        self.state.lock().unwrap().0
    }

    fn utc(&self) -> OffsetDateTime {
        self.state.lock().unwrap().1
    }
}

struct ContendedClock {
    monotonic: Mutex<Instant>,
    block_first_monotonic: AtomicBool,
    first_entered: tokio::sync::Notify,
    later_read: tokio::sync::Notify,
    release_first: (Mutex<bool>, Condvar),
}

impl ContendedClock {
    fn new() -> Self {
        Self {
            monotonic: Mutex::new(Instant::now()),
            block_first_monotonic: AtomicBool::new(true),
            first_entered: tokio::sync::Notify::new(),
            later_read: tokio::sync::Notify::new(),
            release_first: (Mutex::new(false), Condvar::new()),
        }
    }

    fn advance(&self, duration: Duration) {
        *self.monotonic.lock().unwrap() += duration;
    }

    fn release(&self) {
        let (released, signal) = &self.release_first;
        *released.lock().unwrap() = true;
        signal.notify_all();
    }
}

impl Clock for ContendedClock {
    fn monotonic(&self) -> Instant {
        let captured = *self.monotonic.lock().unwrap();
        if self.block_first_monotonic.swap(false, Ordering::SeqCst) {
            self.first_entered.notify_one();
            let (released, signal) = &self.release_first;
            let mut released = released.lock().unwrap();
            while !*released {
                released = signal.wait(released).unwrap();
            }
        } else {
            self.later_read.notify_one();
        }
        captured
    }

    fn utc(&self) -> OffsetDateTime {
        OffsetDateTime::UNIX_EPOCH
    }
}

enum Script {
    Gate,
    Ok,
    Malformed,
    Crash,
    Panic,
    HangReady,
    HangSynthesis,
}

struct ScriptedExecutor {
    scripts: Mutex<VecDeque<Script>>,
    starts: mpsc::UnboundedSender<Uuid>,
    gate: Semaphore,
    cancels: Mutex<Vec<Uuid>>,
}

#[derive(Default)]
struct UnavailableProbe {
    calls: AtomicUsize,
}

struct PanickingCancelExecutor {
    starts: mpsc::UnboundedSender<Uuid>,
}

struct BlockingAvailabilityExecutor {
    entered: tokio::sync::Notify,
    release: (Mutex<bool>, Condvar),
    available: AtomicBool,
}

struct TimedExecutor {
    ready_delay: Duration,
    synthesis_delay: Duration,
    ready_started: tokio::sync::Notify,
    synthesis_started: tokio::sync::Notify,
}

impl TimedExecutor {
    fn new(ready_delay: Duration, synthesis_delay: Duration) -> Arc<Self> {
        Arc::new(Self {
            ready_delay,
            synthesis_delay,
            ready_started: tokio::sync::Notify::new(),
            synthesis_started: tokio::sync::Notify::new(),
        })
    }
}

#[async_trait]
impl SynthesisExecutor for TimedExecutor {
    async fn ready(&self, _task: &SynthesisTask) -> Result<(), ExecutorError> {
        self.ready_started.notify_one();
        tokio::time::sleep(self.ready_delay).await;
        Ok(())
    }

    async fn synthesize(&self, _task: &SynthesisTask) -> Result<Vec<u8>, ExecutorError> {
        self.synthesis_started.notify_one();
        tokio::time::sleep(self.synthesis_delay).await;
        Ok(pcm_wav(2))
    }

    async fn cancel(&self, _id: Uuid) {}
}

impl BlockingAvailabilityExecutor {
    fn new() -> Self {
        Self {
            entered: tokio::sync::Notify::new(),
            release: (Mutex::new(false), Condvar::new()),
            available: AtomicBool::new(true),
        }
    }

    fn release(&self) {
        let (released, signal) = &self.release;
        *released.lock().unwrap() = true;
        signal.notify_all();
    }
}

#[async_trait]
impl SynthesisExecutor for BlockingAvailabilityExecutor {
    fn is_available(&self) -> bool {
        self.entered.notify_one();
        let (released, signal) = &self.release;
        let mut released = released.lock().unwrap();
        while !*released {
            released = signal.wait(released).unwrap();
        }
        self.available.load(Ordering::SeqCst)
    }

    async fn ready(&self, _task: &SynthesisTask) -> Result<(), ExecutorError> {
        Ok(())
    }

    async fn synthesize(&self, _task: &SynthesisTask) -> Result<Vec<u8>, ExecutorError> {
        Ok(pcm_wav(2))
    }

    async fn cancel(&self, _id: Uuid) {}
}

#[async_trait]
impl SynthesisExecutor for PanickingCancelExecutor {
    async fn ready(&self, _task: &SynthesisTask) -> Result<(), ExecutorError> {
        Ok(())
    }

    async fn synthesize(&self, task: &SynthesisTask) -> Result<Vec<u8>, ExecutorError> {
        self.starts.send(task.id).unwrap();
        pending().await
    }

    async fn cancel(&self, _id: Uuid) {
        panic!("injected cancel panic")
    }
}

#[async_trait]
impl SynthesisExecutor for UnavailableProbe {
    fn is_available(&self) -> bool {
        false
    }

    async fn ready(&self, _task: &SynthesisTask) -> Result<(), ExecutorError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Err(ExecutorError::Unavailable)
    }

    async fn synthesize(&self, _task: &SynthesisTask) -> Result<Vec<u8>, ExecutorError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Err(ExecutorError::Unavailable)
    }

    async fn cancel(&self, _id: Uuid) {
        self.calls.fetch_add(1, Ordering::SeqCst);
    }
}

impl ScriptedExecutor {
    fn new(
        scripts: impl IntoIterator<Item = Script>,
    ) -> (Arc<Self>, mpsc::UnboundedReceiver<Uuid>) {
        let (starts, receiver) = mpsc::unbounded_channel();
        (
            Arc::new(Self {
                scripts: Mutex::new(scripts.into_iter().collect()),
                starts,
                gate: Semaphore::new(0),
                cancels: Mutex::new(Vec::new()),
            }),
            receiver,
        )
    }
}

fn pcm_wav(data_len: usize) -> Vec<u8> {
    let mut wav = Vec::with_capacity(44 + data_len);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36_u32 + u32::try_from(data_len).unwrap()).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16_u32.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&1_u16.to_le_bytes());
    wav.extend_from_slice(&24_000_u32.to_le_bytes());
    wav.extend_from_slice(&48_000_u32.to_le_bytes());
    wav.extend_from_slice(&2_u16.to_le_bytes());
    wav.extend_from_slice(&16_u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&u32::try_from(data_len).unwrap().to_le_bytes());
    wav.resize(44 + data_len, 0);
    wav
}

#[async_trait]
impl SynthesisExecutor for ScriptedExecutor {
    async fn ready(&self, _task: &SynthesisTask) -> Result<(), ExecutorError> {
        let hang = matches!(
            self.scripts.lock().unwrap().front(),
            Some(Script::HangReady)
        );
        if hang {
            pending::<Result<(), ExecutorError>>().await
        } else {
            Ok(())
        }
    }

    async fn synthesize(&self, task: &SynthesisTask) -> Result<Vec<u8>, ExecutorError> {
        self.starts.send(task.id).unwrap();
        let script = self
            .scripts
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Script::Ok);
        match script {
            Script::Gate => {
                self.gate.acquire().await.unwrap().forget();
                Ok(pcm_wav(2))
            }
            Script::Ok => Ok(pcm_wav(2)),
            Script::Malformed => Ok(b"RIFFsmall-WAVE".to_vec()),
            Script::Crash => Err(ExecutorError::Crash),
            Script::Panic => panic!("injected executor panic"),
            Script::HangReady | Script::HangSynthesis => {
                pending::<Result<Vec<u8>, ExecutorError>>().await
            }
        }
    }

    async fn cancel(&self, id: Uuid) {
        self.cancels.lock().unwrap().push(id);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn queue_is_global_bounded_per_pairing_fair_and_owner_only() {
    let (executor, mut starts) =
        ScriptedExecutor::new(std::iter::repeat_with(|| Script::Gate).take(6));
    let clock = Arc::new(ManualClock::new());
    let scheduler = Scheduler::new(executor.clone(), clock);
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let voice = VoiceId::parse("pocket:alba").unwrap();
    let a1 = scheduler.enqueue(a, voice, "a1".into()).unwrap();
    let a2 = scheduler.enqueue(a, voice, "a2".into()).unwrap();
    let a3 = scheduler.enqueue(a, voice, "a3".into()).unwrap();
    let b1 = scheduler.enqueue(b, voice, "b1".into()).unwrap();
    let b2 = scheduler.enqueue(b, voice, "b2".into()).unwrap();
    let b3 = scheduler.enqueue(b, voice, "b3".into()).unwrap();

    let expected = [a1, b1, a2, b2, a3, b3];
    for id in expected {
        assert_eq!(starts.recv().await, Some(id));
        let foreign_owner = if [a1, a2, a3].contains(&id) { b } else { a };
        assert_eq!(scheduler.get(foreign_owner, id), Err(JobError::NotFound));
        executor.gate.add_permits(1);
    }
    scheduler.wait_idle().await;
    assert!(scheduler.get(a, a1).is_ok());
    assert!(scheduler.audio(a, a1).is_ok());
    assert_eq!(scheduler.audio(b, a1), Err(JobError::NotFound));

    let (executor, mut starts) = ScriptedExecutor::new([Script::Gate]);
    let scheduler = Scheduler::new(executor.clone(), Arc::new(ManualClock::new()));
    let active = scheduler.enqueue(a, voice, "active".into()).unwrap();
    assert_eq!(starts.recv().await, Some(active));
    for index in 0..3 {
        scheduler
            .enqueue(a, voice, format!("queued-{index}"))
            .unwrap();
    }
    assert_eq!(
        scheduler.enqueue(a, voice, "fourth-queued".into()),
        Err(JobError::PairingQueueFull)
    );
    executor.gate.add_permits(1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn one_active_and_ten_global_queued_are_allowed_but_the_eleventh_is_rejected() {
    let (executor, mut starts) = ScriptedExecutor::new([Script::Gate]);
    let scheduler = Scheduler::new(executor.clone(), Arc::new(ManualClock::new()));
    let voice = VoiceId::parse("pocket:alba").unwrap();
    let owners = [
        Uuid::new_v4(),
        Uuid::new_v4(),
        Uuid::new_v4(),
        Uuid::new_v4(),
    ];
    let active = scheduler
        .enqueue(owners[0], voice, "active".into())
        .unwrap();
    assert_eq!(starts.recv().await, Some(active));

    let mut queued = Vec::new();
    for (owner, count) in [
        (owners[0], 3),
        (owners[1], 3),
        (owners[2], 3),
        (owners[3], 1),
    ] {
        for index in 0..count {
            queued.push((
                owner,
                scheduler
                    .enqueue(owner, voice, format!("queued-{owner}-{index}"))
                    .unwrap(),
            ));
        }
    }
    assert_eq!(
        scheduler.enqueue(owners[3], voice, "eleventh queued".into()),
        Err(JobError::QueueFull)
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(25), starts.recv())
            .await
            .is_err(),
        "a second job must not become active while the first is running"
    );

    let (queued_owner, queued_id) = queued[0];
    assert_eq!(
        scheduler.cancel(owners[1], queued_id),
        Err(JobError::NotFound)
    );
    scheduler.cancel(queued_owner, queued_id).unwrap();
    scheduler.cancel(queued_owner, queued_id).unwrap();
    assert_eq!(
        scheduler.get(queued_owner, queued_id).unwrap().state,
        JobState::Cancelled
    );
    assert_eq!(scheduler.get(owners[1], queued_id), Err(JobError::NotFound));
    assert_eq!(
        scheduler.audio(owners[1], queued_id),
        Err(JobError::NotFound)
    );

    executor.gate.add_permits(1);
    scheduler.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn round_robin_fairness_survives_continuous_arrivals_from_the_active_pairing() {
    let (executor, mut starts) =
        ScriptedExecutor::new(std::iter::repeat_with(|| Script::Gate).take(7));
    let scheduler = Scheduler::new(executor.clone(), Arc::new(ManualClock::new()));
    let voice = VoiceId::parse("pocket:alba").unwrap();
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();

    let a1 = scheduler.enqueue(a, voice, "a1".into()).unwrap();
    assert_eq!(starts.recv().await, Some(a1));
    let a2 = scheduler.enqueue(a, voice, "a2".into()).unwrap();
    let b1 = scheduler.enqueue(b, voice, "b1".into()).unwrap();
    executor.gate.add_permits(1);
    assert_eq!(starts.recv().await, Some(b1));

    let b2 = scheduler.enqueue(b, voice, "b2".into()).unwrap();
    executor.gate.add_permits(1);
    assert_eq!(starts.recv().await, Some(a2));

    let a3 = scheduler.enqueue(a, voice, "a3".into()).unwrap();
    executor.gate.add_permits(1);
    assert_eq!(starts.recv().await, Some(b2));

    let b3 = scheduler.enqueue(b, voice, "b3".into()).unwrap();
    executor.gate.add_permits(1);
    assert_eq!(starts.recv().await, Some(a3));

    let a4 = scheduler.enqueue(a, voice, "a4".into()).unwrap();
    executor.gate.add_permits(1);
    assert_eq!(starts.recv().await, Some(b3));
    executor.gate.add_permits(1);
    assert_eq!(starts.recv().await, Some(a4));
    executor.gate.add_permits(1);
    scheduler.wait_idle().await;
}

#[tokio::test(start_paused = true)]
async fn timeouts_cancel_crash_size_and_cleanup_fail_closed() {
    let voice = VoiceId::parse("pocket:alba").unwrap();
    let owner = Uuid::new_v4();

    let (executor, _starts) = ScriptedExecutor::new([Script::HangReady]);
    let scheduler = Scheduler::new(executor, Arc::new(ManualClock::new()));
    let ready_timeout = scheduler.enqueue(owner, voice, "ready".into()).unwrap();
    tokio::time::advance(Duration::from_secs(121)).await;
    scheduler.wait_idle().await;
    assert_eq!(
        scheduler.get(owner, ready_timeout).unwrap().state,
        JobState::Failed
    );

    let (executor, mut starts) = ScriptedExecutor::new([Script::HangSynthesis]);
    let scheduler = Scheduler::new(executor, Arc::new(ManualClock::new()));
    let synthesis_timeout = scheduler.enqueue(owner, voice, "synth".into()).unwrap();
    assert_eq!(starts.recv().await, Some(synthesis_timeout));
    tokio::time::advance(Duration::from_secs(301)).await;
    scheduler.wait_idle().await;
    assert_eq!(
        scheduler.get(owner, synthesis_timeout).unwrap().state,
        JobState::Failed
    );

    let (executor, mut starts) = ScriptedExecutor::new([Script::HangSynthesis]);
    let scheduler = Scheduler::new(executor.clone(), Arc::new(ManualClock::new()));
    let cancelled = scheduler.enqueue(owner, voice, "cancel".into()).unwrap();
    assert_eq!(starts.recv().await, Some(cancelled));
    scheduler.cancel(owner, cancelled).unwrap();
    scheduler.cancel(owner, cancelled).unwrap();
    tokio::time::advance(Duration::from_secs(3)).await;
    scheduler.wait_idle().await;
    assert_eq!(
        scheduler.get(owner, cancelled).unwrap().state,
        JobState::Cancelled
    );
    assert_eq!(executor.cancels.lock().unwrap().as_slice(), &[cancelled]);

    let (executor, _starts) = ScriptedExecutor::new([Script::Crash, Script::Malformed, Script::Ok]);
    let clock = Arc::new(ManualClock::new());
    let scheduler = Scheduler::new(executor, clock.clone());
    let crashed = scheduler.enqueue(owner, voice, "crash".into()).unwrap();
    let invalid_audio = scheduler.enqueue(owner, voice, "invalid".into()).unwrap();
    let completed = scheduler.enqueue(owner, voice, "ok".into()).unwrap();
    scheduler.wait_idle().await;
    assert_eq!(
        scheduler.get(owner, crashed).unwrap().state,
        JobState::Failed
    );
    assert_eq!(
        scheduler.get(owner, invalid_audio).unwrap().state,
        JobState::Failed
    );
    assert_eq!(
        scheduler.get(owner, completed).unwrap().state,
        JobState::Completed
    );
    assert!(scheduler.audio(owner, completed).is_ok());
    clock.advance(AUDIO_TTL);
    scheduler.sweep();
    assert_eq!(scheduler.audio(owner, completed), Err(JobError::Expired));
    clock.advance(Duration::from_secs(7 * 24 * 60 * 60) - AUDIO_TTL);
    scheduler.sweep();
    assert_eq!(scheduler.get(owner, completed), Err(JobError::NotFound));
}

#[tokio::test(start_paused = true)]
async fn ready_synthesis_and_cancel_grace_deadlines_fire_at_exact_boundaries() {
    let voice = VoiceId::parse("pocket:alba").unwrap();
    let owner = Uuid::new_v4();

    let (executor, _starts) = ScriptedExecutor::new([Script::HangReady]);
    let scheduler = Scheduler::new(executor.clone(), Arc::new(ManualClock::new()));
    let ready = scheduler
        .enqueue(owner, voice, "ready exact".into())
        .unwrap();
    while scheduler.get(owner, ready).unwrap().state == JobState::Queued {
        tokio::task::yield_now().await;
    }
    tokio::time::advance(WORKER_READY_TIMEOUT - Duration::from_millis(1)).await;
    assert_eq!(
        scheduler.get(owner, ready).unwrap().state,
        JobState::Starting
    );
    tokio::time::advance(Duration::from_millis(1)).await;
    scheduler.wait_idle().await;
    assert_eq!(scheduler.get(owner, ready).unwrap().state, JobState::Failed);
    assert_eq!(executor.cancels.lock().unwrap().as_slice(), &[ready]);

    let (executor, mut starts) = ScriptedExecutor::new([Script::HangSynthesis]);
    let scheduler = Scheduler::new(executor.clone(), Arc::new(ManualClock::new()));
    let synthesis = scheduler
        .enqueue(owner, voice, "synthesis exact".into())
        .unwrap();
    assert_eq!(starts.recv().await, Some(synthesis));
    tokio::time::advance(SYNTHESIS_TIMEOUT - Duration::from_millis(1)).await;
    assert_eq!(
        scheduler.get(owner, synthesis).unwrap().state,
        JobState::Synthesizing
    );
    tokio::time::advance(Duration::from_millis(1)).await;
    while executor.cancels.lock().unwrap().is_empty() {
        tokio::task::yield_now().await;
    }
    tokio::time::advance(CANCEL_GRACE - Duration::from_millis(1)).await;
    assert_eq!(
        scheduler.get(owner, synthesis).unwrap().state,
        JobState::Synthesizing
    );
    tokio::time::advance(Duration::from_millis(1)).await;
    scheduler.wait_idle().await;
    assert_eq!(
        scheduler.get(owner, synthesis).unwrap().state,
        JobState::Failed
    );

    let (executor, mut starts) = ScriptedExecutor::new([Script::HangSynthesis]);
    let scheduler = Scheduler::new(executor.clone(), Arc::new(ManualClock::new()));
    let cancelled = scheduler
        .enqueue(owner, voice, "cancel exact".into())
        .unwrap();
    assert_eq!(starts.recv().await, Some(cancelled));
    scheduler.cancel(owner, cancelled).unwrap();
    while executor.cancels.lock().unwrap().is_empty() {
        tokio::task::yield_now().await;
    }
    tokio::time::advance(CANCEL_GRACE - Duration::from_millis(1)).await;
    assert_eq!(
        scheduler.get(owner, cancelled).unwrap().state,
        JobState::Cancelling
    );
    tokio::time::advance(Duration::from_millis(1)).await;
    scheduler.wait_idle().await;
    assert_eq!(
        scheduler.get(owner, cancelled).unwrap().state,
        JobState::Cancelled
    );
}

#[tokio::test(start_paused = true)]
async fn executor_completion_loses_exact_ready_and_synthesis_deadline_ties() {
    let voice = VoiceId::parse("pocket:alba").unwrap();
    let owner = Uuid::new_v4();

    let before_ready = TimedExecutor::new(
        WORKER_READY_TIMEOUT - Duration::from_millis(1),
        Duration::ZERO,
    );
    let scheduler = Scheduler::new(before_ready.clone(), Arc::new(ManualClock::new()));
    let id = scheduler
        .enqueue(owner, voice, "ready before".into())
        .unwrap();
    before_ready.ready_started.notified().await;
    tokio::time::advance(WORKER_READY_TIMEOUT - Duration::from_millis(1)).await;
    scheduler.wait_idle().await;
    assert_eq!(scheduler.get(owner, id).unwrap().state, JobState::Completed);

    let exact_ready = TimedExecutor::new(WORKER_READY_TIMEOUT, Duration::ZERO);
    let scheduler = Scheduler::new(exact_ready.clone(), Arc::new(ManualClock::new()));
    let id = scheduler
        .enqueue(owner, voice, "ready exact tie".into())
        .unwrap();
    exact_ready.ready_started.notified().await;
    tokio::time::advance(WORKER_READY_TIMEOUT).await;
    scheduler.wait_idle().await;
    assert_eq!(scheduler.get(owner, id).unwrap().state, JobState::Failed);

    let before_synthesis =
        TimedExecutor::new(Duration::ZERO, SYNTHESIS_TIMEOUT - Duration::from_millis(1));
    let scheduler = Scheduler::new(before_synthesis.clone(), Arc::new(ManualClock::new()));
    let id = scheduler
        .enqueue(owner, voice, "synthesis before".into())
        .unwrap();
    before_synthesis.synthesis_started.notified().await;
    tokio::time::advance(SYNTHESIS_TIMEOUT - Duration::from_millis(1)).await;
    scheduler.wait_idle().await;
    assert_eq!(scheduler.get(owner, id).unwrap().state, JobState::Completed);

    let exact_synthesis = TimedExecutor::new(Duration::ZERO, SYNTHESIS_TIMEOUT);
    let scheduler = Scheduler::new(exact_synthesis.clone(), Arc::new(ManualClock::new()));
    let id = scheduler
        .enqueue(owner, voice, "synthesis exact tie".into())
        .unwrap();
    exact_synthesis.synthesis_started.notified().await;
    tokio::time::advance(SYNTHESIS_TIMEOUT).await;
    scheduler.wait_idle().await;
    assert_eq!(scheduler.get(owner, id).unwrap().state, JobState::Failed);
}

#[tokio::test]
async fn production_executor_is_non_operational_and_produces_no_audio() {
    let scheduler = Scheduler::new(
        Arc::new(UnavailableExecutor::new()),
        Arc::new(ManualClock::new()),
    );
    let owner = Uuid::new_v4();
    assert_eq!(
        scheduler.enqueue(
            owner,
            VoiceId::parse("pocket:alba").unwrap(),
            "No output".into()
        ),
        Err(JobError::RuntimeUnavailable)
    );

    let probe = Arc::new(UnavailableProbe::default());
    let scheduler = Scheduler::new(probe.clone(), Arc::new(ManualClock::new()));
    assert_eq!(
        scheduler.enqueue(
            owner,
            VoiceId::parse("pocket:alba").unwrap(),
            "No probe work".into(),
        ),
        Err(JobError::RuntimeUnavailable)
    );
    assert_eq!(probe.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn snapshots_expose_safe_lifecycle_timestamps_without_retaining_text() {
    let (executor, _starts) = ScriptedExecutor::new([Script::Ok]);
    let scheduler = Scheduler::new(executor, Arc::new(ManualClock::new()));
    let owner = Uuid::new_v4();
    let id = scheduler
        .enqueue(
            owner,
            VoiceId::parse("pocket:alba").unwrap(),
            "private synthesis text".into(),
        )
        .unwrap();
    scheduler.wait_idle().await;

    let snapshot = scheduler.get(owner, id).unwrap();
    assert_eq!(snapshot.created_at, OffsetDateTime::UNIX_EPOCH);
    assert_eq!(snapshot.finished_at, Some(OffsetDateTime::UNIX_EPOCH));
}

#[tokio::test]
async fn finished_timestamp_never_precedes_created_timestamp_when_wall_clock_moves_back() {
    let (executor, mut starts) = ScriptedExecutor::new([Script::Gate]);
    let clock = Arc::new(ManualClock::new());
    let scheduler = Scheduler::new(executor.clone(), clock.clone());
    let owner = Uuid::new_v4();
    let id = scheduler
        .enqueue(
            owner,
            VoiceId::parse("pocket:alba").unwrap(),
            "timestamp".into(),
        )
        .unwrap();
    assert_eq!(starts.recv().await, Some(id));
    clock.set_utc(OffsetDateTime::UNIX_EPOCH - time::Duration::hours(1));
    executor.gate.add_permits(1);
    scheduler.wait_idle().await;

    let snapshot = scheduler.get(owner, id).unwrap();
    assert_eq!(snapshot.created_at, OffsetDateTime::UNIX_EPOCH);
    assert_eq!(snapshot.finished_at, Some(OffsetDateTime::UNIX_EPOCH));
}

#[tokio::test(start_paused = true)]
async fn production_worker_automatically_sweeps_audio_every_five_minutes() {
    let (executor, _starts) = ScriptedExecutor::new([Script::Ok]);
    let clock = Arc::new(ManualClock::new());
    let scheduler = Scheduler::new(executor, clock.clone());
    let owner = Uuid::new_v4();
    let id = scheduler
        .enqueue(
            owner,
            VoiceId::parse("pocket:alba").unwrap(),
            "automatic sweep".into(),
        )
        .unwrap();
    scheduler.wait_idle().await;
    assert!(scheduler.get(owner, id).unwrap().audio_available);

    clock.advance(AUDIO_TTL);
    tokio::time::advance(SWEEP_INTERVAL).await;
    tokio::task::yield_now().await;

    assert!(!scheduler.get(owner, id).unwrap().audio_available);
    assert_eq!(scheduler.audio(owner, id), Err(JobError::Expired));
}

#[tokio::test]
async fn snapshot_stops_advertising_audio_at_the_exact_ttl_before_the_next_sweep() {
    let (executor, _starts) = ScriptedExecutor::new([Script::Ok]);
    let clock = Arc::new(ManualClock::new());
    let scheduler = Scheduler::new(executor, clock.clone());
    let owner = Uuid::new_v4();
    let id = scheduler
        .enqueue(
            owner,
            VoiceId::parse("pocket:alba").unwrap(),
            "ttl truth".into(),
        )
        .unwrap();
    scheduler.wait_idle().await;
    assert!(scheduler.get(owner, id).unwrap().audio_available);

    clock.advance(AUDIO_TTL);

    assert!(!scheduler.get(owner, id).unwrap().audio_available);
    assert_eq!(scheduler.audio(owner, id), Err(JobError::Expired));
}

#[tokio::test]
async fn metadata_retention_uses_monotonic_time_despite_wall_clock_jumps() {
    let (executor, _starts) = ScriptedExecutor::new([Script::Ok]);
    let clock = Arc::new(ManualClock::new());
    let scheduler = Scheduler::new(executor, clock.clone());
    let owner = Uuid::new_v4();
    let id = scheduler
        .enqueue(
            owner,
            VoiceId::parse("pocket:alba").unwrap(),
            "retention clock".into(),
        )
        .unwrap();
    scheduler.wait_idle().await;

    clock.set_utc(OffsetDateTime::UNIX_EPOCH + time::Duration::days(8));
    scheduler.sweep();
    assert!(scheduler.get(owner, id).is_ok());

    clock.set_utc(OffsetDateTime::UNIX_EPOCH);
    clock.advance(Duration::from_secs(7 * 24 * 60 * 60));
    scheduler.sweep();
    assert_eq!(scheduler.get(owner, id), Err(JobError::NotFound));
}

#[tokio::test]
async fn metadata_is_non_oracular_not_found_at_exact_retention_without_a_sweep() {
    let (executor, _starts) = ScriptedExecutor::new([Script::Ok]);
    let clock = Arc::new(ManualClock::new());
    let scheduler = Scheduler::new(executor, clock.clone());
    let owner = Uuid::new_v4();
    let id = scheduler
        .enqueue(
            owner,
            VoiceId::parse("pocket:alba").unwrap(),
            "retention endpoint boundary".into(),
        )
        .unwrap();
    scheduler.wait_idle().await;

    clock.advance(METADATA_RETENTION - Duration::from_millis(1));
    assert!(scheduler.get(owner, id).is_ok());
    assert_eq!(scheduler.audio(owner, id), Err(JobError::Expired));
    assert_eq!(scheduler.cancel(owner, id), Ok(()));

    clock.advance(Duration::from_millis(1));
    assert_eq!(scheduler.get(owner, id), Err(JobError::NotFound));
    assert_eq!(scheduler.audio(owner, id), Err(JobError::NotFound));
    assert_eq!(scheduler.cancel(owner, id), Err(JobError::NotFound));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn metadata_visibility_uses_a_clock_read_after_waiting_for_the_state_lock() {
    let (executor, _starts) = ScriptedExecutor::new([Script::Ok]);
    let clock = Arc::new(ContendedClock::new());
    let scheduler = Scheduler::new(executor, clock.clone());
    let owner = Uuid::new_v4();
    let id = scheduler
        .enqueue(
            owner,
            VoiceId::parse("pocket:alba").unwrap(),
            "contended retention boundary".into(),
        )
        .unwrap();
    tokio::time::timeout(Duration::from_secs(1), clock.first_entered.notified())
        .await
        .expect("job completion did not enter the contended monotonic read");

    let get_scheduler = scheduler.clone();
    let get = tokio::task::spawn_blocking(move || get_scheduler.get(owner, id));
    let _read_before_release =
        tokio::time::timeout(Duration::from_millis(50), clock.later_read.notified()).await;
    clock.advance(METADATA_RETENTION);
    clock.release();
    scheduler.wait_idle().await;

    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), get)
            .await
            .expect("contended get did not resume")
            .unwrap(),
        Err(JobError::NotFound)
    );
}

#[tokio::test]
async fn executor_audio_must_be_a_well_formed_pcm16_mono_24khz_wav() {
    let (executor, _starts) = ScriptedExecutor::new([Script::Malformed]);
    let scheduler = Scheduler::new(executor, Arc::new(ManualClock::new()));
    let owner = Uuid::new_v4();
    let id = scheduler
        .enqueue(
            owner,
            VoiceId::parse("pocket:alba").unwrap(),
            "audio".into(),
        )
        .unwrap();
    scheduler.wait_idle().await;

    assert_eq!(scheduler.get(owner, id).unwrap().state, JobState::Failed);
    assert_eq!(scheduler.audio(owner, id), Err(JobError::Conflict));
}

#[tokio::test]
async fn cancellation_wins_when_executor_success_is_already_ready() {
    let (executor, mut starts) =
        ScriptedExecutor::new(std::iter::repeat_with(|| Script::Gate).take(32));
    let scheduler = Scheduler::new(executor.clone(), Arc::new(ManualClock::new()));
    let owner = Uuid::new_v4();
    let voice = VoiceId::parse("pocket:alba").unwrap();

    for index in 0..32 {
        let id = scheduler
            .enqueue(owner, voice, format!("race-{index}"))
            .unwrap();
        assert_eq!(starts.recv().await, Some(id));
        scheduler.cancel(owner, id).unwrap();
        assert_eq!(
            scheduler.get(owner, id).unwrap().state,
            JobState::Cancelling
        );
        executor.gate.add_permits(1);
        scheduler.wait_idle().await;
        assert_eq!(scheduler.get(owner, id).unwrap().state, JobState::Cancelled);
        assert_eq!(scheduler.audio(owner, id), Err(JobError::Conflict));
    }
}

#[tokio::test(start_paused = true)]
async fn shutdown_is_bounded_and_drops_queued_jobs_and_audio() {
    let (executor, mut starts) = ScriptedExecutor::new([Script::HangSynthesis, Script::Ok]);
    let scheduler = Scheduler::new(executor, Arc::new(ManualClock::new()));
    let owner = Uuid::new_v4();
    let voice = VoiceId::parse("pocket:alba").unwrap();
    let active = scheduler
        .enqueue(owner, voice, "active secret".into())
        .unwrap();
    let queued = scheduler
        .enqueue(owner, voice, "queued secret".into())
        .unwrap();
    assert_eq!(starts.recv().await, Some(active));

    let shutdown_scheduler = scheduler.clone();
    let shutdown = tokio::spawn(async move { shutdown_scheduler.shutdown().await });
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_secs(2)).await;
    shutdown.await.unwrap();

    assert_eq!(scheduler.get(owner, active), Err(JobError::NotFound));
    assert_eq!(scheduler.get(owner, queued), Err(JobError::NotFound));
    assert_eq!(
        scheduler.enqueue(owner, voice, "late".into()),
        Err(JobError::ShuttingDown)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn enqueue_rechecks_shutdown_after_a_blocked_availability_probe() {
    let executor = Arc::new(BlockingAvailabilityExecutor::new());
    let scheduler = Scheduler::new(executor.clone(), Arc::new(ManualClock::new()));
    let enqueue_scheduler = scheduler.clone();
    let owner = Uuid::new_v4();
    let voice = VoiceId::parse("pocket:alba").unwrap();
    let enqueue = tokio::task::spawn_blocking(move || {
        enqueue_scheduler.enqueue(owner, voice, "shutdown race".into())
    });
    tokio::time::timeout(Duration::from_secs(1), executor.entered.notified())
        .await
        .expect("availability probe did not block");

    tokio::time::timeout(Duration::from_secs(1), scheduler.shutdown())
        .await
        .expect("shutdown must not wait for an availability probe");
    executor.release();

    assert_eq!(enqueue.await.unwrap(), Err(JobError::ShuttingDown));
}

#[tokio::test(flavor = "current_thread")]
async fn immediate_shutdown_cannot_lose_its_worker_wakeup() {
    let (executor, _starts) = ScriptedExecutor::new([]);
    let scheduler = Scheduler::new(executor, Arc::new(ManualClock::new()));

    tokio::time::timeout(Duration::from_millis(50), scheduler.shutdown())
        .await
        .expect("shutdown wakeup must be retained before the worker first awaits");
}

#[tokio::test(flavor = "current_thread")]
async fn drop_only_shutdown_releases_the_worker_core_cycle() {
    let (executor, _starts) = ScriptedExecutor::new([]);
    let weak_executor = Arc::downgrade(&executor);
    let scheduler = Scheduler::new(executor, Arc::new(ManualClock::new()));

    drop(scheduler);

    tokio::time::timeout(Duration::from_millis(50), async {
        while weak_executor.upgrade().is_some() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("drop-only shutdown must release the core-owned worker handle");
}

#[tokio::test]
async fn executor_panic_fails_the_job_and_worker_continues() {
    let (executor, _starts) = ScriptedExecutor::new([Script::Panic, Script::Ok]);
    let scheduler = Scheduler::new(executor, Arc::new(ManualClock::new()));
    let owner = Uuid::new_v4();
    let voice = VoiceId::parse("pocket:alba").unwrap();
    let panicked = scheduler.enqueue(owner, voice, "panic".into()).unwrap();
    let next = scheduler.enqueue(owner, voice, "next".into()).unwrap();

    assert!(
        tokio::time::timeout(Duration::from_secs(1), scheduler.wait_idle())
            .await
            .is_ok()
    );
    assert_eq!(
        scheduler.get(owner, panicked).unwrap().state,
        JobState::Failed
    );
    assert_eq!(
        scheduler.get(owner, next).unwrap().state,
        JobState::Completed
    );
}

#[tokio::test]
async fn executor_cancel_panic_cannot_leave_the_active_generation_stuck() {
    let (starts, mut started) = mpsc::unbounded_channel();
    let scheduler = Scheduler::new(
        Arc::new(PanickingCancelExecutor { starts }),
        Arc::new(ManualClock::new()),
    );
    let owner = Uuid::new_v4();
    let id = scheduler
        .enqueue(
            owner,
            VoiceId::parse("pocket:alba").unwrap(),
            "cancel panic".into(),
        )
        .unwrap();
    assert_eq!(started.recv().await, Some(id));

    scheduler.cancel(owner, id).unwrap();

    tokio::time::timeout(Duration::from_secs(1), scheduler.wait_idle())
        .await
        .expect("cancel panic must be contained without killing the worker");
    assert_eq!(scheduler.get(owner, id).unwrap().state, JobState::Cancelled);
}
