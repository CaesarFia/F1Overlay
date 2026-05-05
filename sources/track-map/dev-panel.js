export class DevPanel {
  constructor(hooks) {
    this.hooks = hooks;
    this.status = null;
  }

  mount() {
    const panel = document.createElement('div');
    panel.style.cssText = 'position:absolute;right:12px;top:12px;width:280px;background:rgba(0,0,0,.7);color:#fff;padding:10px;font:12px monospace;z-index:9';

    const speedLabel = document.createElement('label');
    speedLabel.textContent = 'Speed ';
    const speed = document.createElement('input');
    speed.type = 'range';
    speed.min = '0.1';
    speed.max = '20';
    speed.step = '0.1';
    speed.value = String(this.hooks.getPlayback().getSpeed());
    speed.addEventListener('input', () => this.hooks.onSpeedChange(Number(speed.value)));
    speedLabel.append(speed);

    const jumpLabel = document.createElement('label');
    jumpLabel.textContent = ' Jump lap ';
    const jumpInput = document.createElement('input');
    jumpInput.type = 'number';
    jumpInput.min = '1';
    jumpInput.value = '1';
    jumpInput.style.cssText = 'width:52px;margin-left:4px';
    const jumpButton = document.createElement('button');
    jumpButton.textContent = 'Jump';
    jumpButton.addEventListener('click', () => this.hooks.onJumpToLap(Number(jumpInput.value)));
    jumpLabel.append(jumpInput, jumpButton);

    this.status = document.createElement('div');
    this.status.textContent = 't=0:00  processed=0';

    panel.append(speedLabel, document.createElement('br'), jumpLabel, document.createElement('br'), this.status);
    document.body.append(panel);
  }

  tick(timeStr, processed) {
    if (this.status) this.status.textContent = `t=${timeStr}  processed=${processed}`;
  }
}
