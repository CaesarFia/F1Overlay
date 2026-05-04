export class DevPanel {
  constructor(opts) { this.opts = opts; }

  mount() {
    const p = document.createElement('div');
    p.style.cssText = 'position:absolute;top:8px;left:8px;background:#111c;color:#fff;padding:8px;font:12px monospace;z-index:10';

    const status = document.createElement('div');
    status.textContent = 'Dev Panel';

    const speed = document.createElement('input');
    speed.type = 'range';
    speed.min = '0.1';
    speed.max = '20';
    speed.step = '0.1';
    speed.value = '1';
    speed.addEventListener('input', () => this.opts.onSpeedChange(Number(speed.value)));

    const lapInput = document.createElement('input');
    lapInput.type = 'number';
    lapInput.min = '1';
    lapInput.max = '78';
    lapInput.value = '1';
    lapInput.style.cssText = 'width:50px;margin-right:4px';

    const jumpBtn = document.createElement('button');
    jumpBtn.textContent = 'Jump';
    jumpBtn.addEventListener('click', () => {
      const n = parseInt(lapInput.value, 10);
      if (!Number.isNaN(n)) this.opts.onJumpToLap?.(n);
    });

    const lapRow = document.createElement('div');
    lapRow.append('Lap: ', lapInput, jumpBtn);

    p.append(status, speed, lapRow);
    document.body.appendChild(p);
    this.status = status;
  }

  tick(sessionTime, processed) {
    if (this.status) this.status.textContent = `t=${Math.floor(sessionTime)} processed=${processed}`;
  }
}
