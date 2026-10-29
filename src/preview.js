export function createPlanningPreview(game) {
  let previous = [];
  return (index, kind) => {
    if (game.phase !== 'planning' || game.paused || game.enemies.length || game.pending.length) {
      previous = [];
      return game.preview(index, kind);
    }
    const cost = game.costOf(kind);
    const cached = previous.find(entry => entry.layout === game.distances && entry.credits === game.credits
      && entry.index === index && entry.kind === kind && entry.cost === cost);
    if (cached) return cached.value;
    const value = game.preview(index, kind);
    // The canvas hover and the HUD's selected cell can be different.
    previous.unshift({layout: game.distances, credits: game.credits, index, kind, cost, value});
    previous.length = Math.min(previous.length, 2);
    return value;
  };
}
