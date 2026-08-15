import assert from 'node:assert/strict';
import { registerCommandAlias } from '../src/command-compat.js';

function fixture(commands = {}) {
  let cleanup = null;
  const manager = {
    commands,
    addCommand(command) { this.commands[command.id] = command; },
    removeCommand(id) { delete this.commands[id]; },
  };
  return { manager, plugin: { app: { commands: manager }, register(callback) { cleanup = callback; } }, cleanup: () => cleanup?.() };
}

const current = fixture(); let launches = 0;
assert.equal(registerCommandAlias(current.plugin, 'giblicious-search:semantic-search-current-file', 'Legacy current-file search', () => { launches++; }), true);
assert.equal(current.manager.commands['giblicious-search:semantic-search-current-file'].id, 'giblicious-search:semantic-search-current-file');
current.manager.commands['giblicious-search:semantic-search-current-file'].callback(); assert.equal(launches, 1, 'The saved Commander id did not invoke current-file search');
current.cleanup(); assert.equal(current.manager.commands['giblicious-search:semantic-search-current-file'], undefined, 'Plugin unload left the compatibility command registered');

const existingCommand = { id: 'giblicious-search:semantic-search-current-file', callback() {} }, existing = fixture({ [existingCommand.id]: existingCommand });
assert.equal(registerCommandAlias(existing.plugin, existingCommand.id, 'Do not replace', () => {}), false); assert.strictEqual(existing.manager.commands[existingCommand.id], existingCommand, 'Compatibility registration replaced a live command owned by another plugin');

console.log('Command compatibility checks passed.');
