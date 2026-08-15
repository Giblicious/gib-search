function registerCommandAlias(plugin, id, name, callback) {
  const manager = plugin?.app?.commands;
  if (!manager || !id || typeof callback !== 'function' || manager.commands?.[id]) return false;
  const command = { id, name, callback };
  if (typeof manager.addCommand === 'function') manager.addCommand(command);
  else {
    manager.commands ||= {};
    manager.commands[id] = command;
  }
  const registered = manager.commands?.[id] || command;
  plugin.register?.(() => {
    if (manager.commands && manager.commands[id] !== registered) return;
    if (typeof manager.removeCommand === 'function') manager.removeCommand(id);
    else if (manager.commands) delete manager.commands[id];
  });
  return true;
}

export { registerCommandAlias };
