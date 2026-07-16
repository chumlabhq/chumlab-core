// Resolves to [{ kind: 'lint', message, loc? }] per the frozen verify contract.
async function lint(code) {
  throw new Error('lint gate is not implemented');
}

module.exports = { lint };
