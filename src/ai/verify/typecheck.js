// Resolves to [{ kind: 'type', message, loc? }] per the frozen verify contract.
async function typecheck(code) {
  throw new Error('typecheck gate is not implemented');
}

module.exports = { typecheck };
