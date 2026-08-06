export interface SurvivalHudState {
  readonly vitality: number;
  readonly maxVitality: number;
  readonly invulnerabilityRemainingSeconds: number;
  readonly terminal: boolean;
  readonly wave: number;
  readonly activeEncounters: number;
  readonly encounterCap: number;
}

export interface SurvivalHud {
  readonly element: HTMLElement;
  update(state: SurvivalHudState): void;
  destroy(): void;
}

export function createSurvivalHud(
  parent: HTMLElement,
  onRestart: () => void,
): SurvivalHud {
  const element = document.createElement('section');
  element.id = 'survival-hud';
  element.className = 'survival-hud';
  element.setAttribute('aria-label', 'Survival status');
  element.innerHTML = `
    <div class="survival-hud__topline">
      <div>
        <p class="survival-hud__eyebrow">Spark shell</p>
        <p class="survival-hud__title">SURVIVAL RUN</p>
      </div>
      <p class="survival-hud__wave" data-survival-wave>WAVE 01</p>
    </div>
    <div class="survival-hud__health-row">
      <span class="survival-hud__label">VITALITY</span>
      <span class="survival-hud__health-value" data-survival-health>3 / 3</span>
    </div>
    <div class="survival-hud__bar" aria-hidden="true">
      <span class="survival-hud__bar-fill" data-survival-health-fill></span>
    </div>
    <p class="survival-hud__status" data-survival-status aria-live="polite">SPARK READY</p>
    <p class="survival-hud__encounters" data-survival-encounters>0 / 3 ACTIVE</p>
    <button class="survival-hud__restart" type="button" data-survival-restart>RESTART RUN</button>
  `;
  parent.append(element);

  const healthValue = requireElement<HTMLElement>(element, '[data-survival-health]');
  const healthFill = requireElement<HTMLElement>(element, '[data-survival-health-fill]');
  const status = requireElement<HTMLElement>(element, '[data-survival-status]');
  const wave = requireElement<HTMLElement>(element, '[data-survival-wave]');
  const encounters = requireElement<HTMLElement>(element, '[data-survival-encounters]');
  const restart = requireElement<HTMLButtonElement>(element, '[data-survival-restart]');
  restart.addEventListener('click', onRestart);

  return {
    element,
    update(state) {
      const maxVitality = Math.max(1, finiteOrZero(state.maxVitality));
      const vitality = clamp(finiteOrZero(state.vitality), 0, maxVitality);
      const invulnerability = Math.max(0, finiteOrZero(state.invulnerabilityRemainingSeconds));
      const healthPercent = Math.round((vitality / maxVitality) * 100);
      healthValue.textContent = `${vitality} / ${maxVitality}`;
      healthFill.style.width = `${healthPercent}%`;
      element.classList.toggle('is-damaged', invulnerability > 0 && !state.terminal);
      element.classList.toggle('is-defeated', state.terminal);
      status.textContent = state.terminal
        ? 'DEFEATED — RESTART TO PLAY'
        : invulnerability > 0
          ? `HIT — SHIELD ${invulnerability.toFixed(2)}s`
          : 'SPARK READY';
      wave.textContent = `WAVE ${Math.max(1, Math.floor(finiteOrZero(state.wave))).toString().padStart(2, '0')}`;
      encounters.textContent = `${Math.max(0, Math.floor(finiteOrZero(state.activeEncounters)))} / ${Math.max(0, Math.floor(finiteOrZero(state.encounterCap)))} ACTIVE`;
      restart.hidden = !state.terminal;
    },
    destroy() {
      restart.removeEventListener('click', onRestart);
      element.remove();
    },
  };
}

function requireElement<T extends HTMLElement>(parent: HTMLElement, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Survival HUD markup is incomplete: ${selector}`);
  return element;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
