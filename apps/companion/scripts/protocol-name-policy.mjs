function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function splitName(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

function tokenHasForbiddenConcept(token, forbidden, contextual) {
  if (forbidden.has(token)) return true;
  const words = [...forbidden, ...contextual].sort((left, right) => right.length - left.length);
  const states = new Map([['0', false]]);
  for (let index = 0; index < token.length; index += 1) {
    for (const seenForbidden of [false, true]) {
      if (!states.has(`${index}:${seenForbidden}`) && !(index === 0 && !seenForbidden)) continue;
      for (const word of words) {
        if (!token.startsWith(word, index)) continue;
        const nextSeen = seenForbidden || forbidden.has(word);
        states.set(`${index + word.length}:${nextSeen}`, true);
      }
    }
  }
  return states.has(`${token.length}:true`);
}

function readPolicy(document) {
  const policy = isRecord(document) ? document['x-forbidden-name-policy'] : undefined;
  if (
    !isRecord(policy) ||
    !Array.isArray(policy.forbiddenLexemes) ||
    !policy.forbiddenLexemes.every((value) => typeof value === 'string') ||
    !Array.isArray(policy.contextualLexemes) ||
    !policy.contextualLexemes.every((value) => typeof value === 'string') ||
    !Array.isArray(policy.forbiddenPhrases) ||
    !policy.forbiddenPhrases.every(
      (phrase) =>
        Array.isArray(phrase) &&
        phrase.length > 0 &&
        phrase.every((value) => typeof value === 'string'),
    )
  ) {
    throw new Error('OpenAPI forbidden-name policy is missing or invalid.');
  }
  return policy;
}

export function hasForbiddenName(name, policy) {
  const forbidden = new Set(policy.forbiddenLexemes);
  const contextual = new Set(policy.contextualLexemes);
  const tokens = splitName(name);
  const containsForbiddenPhrase = policy.forbiddenPhrases.some((phrase) =>
    tokens.some((_, index) =>
      phrase.every((word, phraseIndex) => tokens[index + phraseIndex] === word),
    ),
  );
  return (
    containsForbiddenPhrase ||
    tokens.some((token) => tokenHasForbiddenConcept(token, forbidden, contextual)) ||
    tokenHasForbiddenConcept(tokens.join(''), forbidden, contextual)
  );
}

export function collectProtocolNameEntries(document) {
  const entries = [];
  const add = (kind, location, name) => {
    if (typeof name === 'string') entries.push({ kind, location, name });
  };
  const components = isRecord(document) && isRecord(document.components) ? document.components : {};
  const schemas = isRecord(components.schemas) ? components.schemas : {};
  for (const name of Object.keys(schemas)) add('schema', `components.schemas.${name}`, name);

  const seen = new Set();
  const visitSchema = (value, location) => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((child, index) => visitSchema(child, `${location}[${index}]`));
      return;
    }
    if (isRecord(value.properties)) {
      for (const [name, child] of Object.entries(value.properties)) {
        add('property', `${location}.properties.${name}`, name);
        visitSchema(child, `${location}.properties.${name}`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'properties') visitSchema(child, `${location}.${key}`);
    }
  };
  visitSchema(schemas, 'components.schemas');

  const componentParameters = isRecord(components.parameters) ? components.parameters : {};
  for (const [key, parameter] of Object.entries(componentParameters)) {
    add('component-parameter', `components.parameters.${key}`, key);
    if (isRecord(parameter)) {
      add('wire-parameter', `components.parameters.${key}.name`, parameter.name);
    }
  }

  const addInlineParameters = (parameters, location, kind) => {
    if (!Array.isArray(parameters)) return;
    parameters.forEach((parameter, index) => {
      if (isRecord(parameter) && !('$ref' in parameter)) {
        add(kind, `${location}[${index}].name`, parameter.name);
      }
    });
  };
  const paths = isRecord(document) && isRecord(document.paths) ? document.paths : {};
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) continue;
    addInlineParameters(pathItem.parameters, `paths.${path}.parameters`, 'path-parameter');
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!isRecord(operation)) continue;
      add('operation', `paths.${path}.${method}.operationId`, operation.operationId);
      addInlineParameters(
        operation.parameters,
        `paths.${path}.${method}.parameters`,
        'operation-parameter',
      );
    }
  }
  return entries;
}

export function collectProtocolNames(document) {
  return [...new Set(collectProtocolNameEntries(document).map((entry) => entry.name))];
}

export function assertProtocolNamePolicy(document) {
  const policy = readPolicy(document);
  const violation = collectProtocolNameEntries(document).find((entry) =>
    hasForbiddenName(entry.name, policy),
  );
  if (violation !== undefined) {
    throw new Error(
      `OpenAPI forbidden name "${violation.name}" at ${violation.location} is not allowed.`,
    );
  }
}
