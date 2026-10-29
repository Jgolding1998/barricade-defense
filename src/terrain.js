export function createTerrainLayer({width, height, cell, left, top, viewWidth, viewHeight}, makeCanvas = () => document.createElement('canvas')) {
  const surface = makeCanvas();
  const context = surface.getContext('2d');

  function resize(ratio, rocks) {
    const scale = Number.isFinite(ratio) && ratio > 0 ? Math.min(2, ratio) : 1;
    surface.width = Math.round(viewWidth * scale);
    surface.height = Math.round(viewHeight * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.fillStyle = '#0e1921'; context.fillRect(0, 0, viewWidth, viewHeight);
    for (let index = 0; index < width * height; index++) {
      const x = left + (index % width) * cell, y = top + Math.floor(index / width) * cell;
      context.fillStyle = (index + Math.floor(index / width)) % 2 ? '#15242e' : '#14222b';
      context.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      context.strokeStyle = '#20343f'; context.lineWidth = 0.5;
      context.strokeRect(x, y, cell, cell);
      if (rocks.has(index)) {
        context.fillStyle = '#263844'; context.fillRect(x + 5, y + 5, cell - 10, cell - 10);
        context.fillStyle = '#2e4551'; context.fillRect(x + 5, y + 5, cell - 10, 4);
        context.strokeStyle = '#3b515d'; context.lineWidth = 1;
        context.beginPath(); context.moveTo(x + 12, y + 14); context.lineTo(x + cell - 12, y + cell - 14); context.stroke();
        context.beginPath(); context.moveTo(x + cell - 14, y + 12); context.lineTo(x + 14, y + cell - 12); context.stroke();
      }
    }
  }

  function draw(target) {
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.drawImage(surface, 0, 0);
    target.restore();
  }

  return {resize, draw};
}
