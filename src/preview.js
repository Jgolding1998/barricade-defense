export function createPlanningPreview(game) {
  let previous = null;
  return (index, kind) => {
    if (game.phase !== 'planning' || game.paused || game.enemies.length || game.pending.length) {
      previous = null;
      return game.preview(index, kind);
    }
    const cost = game.costOf(kind);
    if (previous && previous.layout === game.distances && previous.credits === game.credits
        && previous.index === index && previous.kind === kind && previous.cost === cost) {
      return previous.value;
    }
    const value = game.preview(index, kind);
    previous = {layout: game.distances, credits: game.credits, index, kind, cost, value};
    return value;
  };
}
