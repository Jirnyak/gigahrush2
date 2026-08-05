import { type InputState } from './core/types';
import {
  type BooleanInputKey,
  MOBILE_ACTIONS,
  type MobileMenuId,
  type MobileText,
} from './systems/mobile_actions';
import {
  canUseMobileFullscreen,
  enterMobileFullscreen,
  exitMobileFullscreen,
  isEmbeddedViewport,
  isMobileFullscreenActive,
  openStandalonePage,
} from './fullscreen';
import { isStandaloneDisplay } from './pwa';
import { getLocalizationLanguage } from './systems/localization';
import { setMobileHudSafeContext, type HudSafeInsets } from './render/ui_layout';

export type { MobileMenuId } from './systems/mobile_actions';

export interface MobileControlsContext {
  started: boolean;
  menuOpen: boolean;
  canInteract: boolean;
  gameOver: boolean;
}

export interface MobileControls {
  isEnabled(): boolean;
  refresh(): void;
  resetInput(): void;
  updateContext(context: MobileControlsContext): void;
  destroy(): void;
}

interface MobileControlsOptions {
  onGesture(): void;
  onMenu(menu: MobileMenuId): void;
  onConfirm(): void;
  onClose(): void;
}

function mobileText(text: MobileText): string {
  return getLocalizationLanguage() === 'en' ? text.en : text.ru;
}

function mobileInteractLabel(): string {
  return mobileText({ ru: 'ДЕЙСТ', en: 'ACT' });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function shouldUseTouchControls(): boolean {
  const ua = navigator.userAgent;
  const mobileUa = /android|iphone|ipad|ipod|mobile/i.test(ua);
  
  if (mobileUa) return true;

  if (window.matchMedia) {
    const isCoarse = window.matchMedia('(pointer: coarse)').matches;
    const isFine = window.matchMedia('(pointer: fine)').matches;
    
    if (isFine && !isCoarse) return false;
    if (isCoarse) return true;
    
    const hasCoarse = window.matchMedia('(any-pointer: coarse)').matches;
    if (!hasCoarse) return false;
  }

  const touchCapable = navigator.maxTouchPoints > 0 || 'ontouchstart' in globalThis;
  const compactViewport = Math.min(window.innerWidth, window.innerHeight) < 900;
  return touchCapable && compactViewport;
}

function mobileViewportSize(): { w: number; h: number } {
  const viewport = window.visualViewport;
  return {
    w: Math.max(1, Math.round(viewport?.width ?? window.innerWidth)),
    h: Math.max(1, Math.round(viewport?.height ?? window.innerHeight)),
  };
}

function computeMobileHudSafeInsets(active: boolean): { portrait: boolean; safeInsets?: HudSafeInsets } {
  const { w, h } = mobileViewportSize();
  const portrait = h > w;
  if (!active) return { portrait };
  const pad = clamp(h * 0.26, 92, 148);
  const edge = 14;
  const rail = 62 + 12;
  const lookReserve = 86 + pad + 10;
  const fullscreenReserve = 10 + 42 + 8;
  return {
    portrait,
    safeInsets: {
      top: fullscreenReserve,
      left: Math.min(w * 0.36, edge + pad + 10),
      right: Math.min(w * 0.42, Math.max(rail, lookReserve)),
      bottom: Math.min(h * 0.38, edge + pad + 10),
    },
  };
}

function capturePointer(target: EventTarget | null, pointerId: number): void {
  if (target instanceof HTMLElement) {
    target.setPointerCapture(pointerId);
  }
}

function releasePointer(target: EventTarget | null, pointerId: number): void {
  if (target instanceof HTMLElement && target.hasPointerCapture(pointerId)) {
    target.releasePointerCapture(pointerId);
  }
}

function makeButton(className: string, label: string, ariaLabel: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);
  return button;
}


class MobileControlsImpl implements MobileControls {
  private readonly root = document.createElement('div');
  private readonly rotate = document.createElement('div');
  private readonly movePad = makeButton('mobile-pad mobile-pad--move', '', 'Джойстик движения');
  private readonly moveThumb = document.createElement('span');
  private readonly lookPad = makeButton('mobile-pad mobile-pad--look', '', 'Джойстик камеры');
  private readonly lookThumb = document.createElement('span');
  private readonly interact = makeButton('mobile-interact', mobileInteractLabel(), mobileText({ ru: 'Взаимодействие', en: 'Interact' }));
  private readonly fire = makeButton('mobile-fire-zone', '', mobileText({ ru: 'Атака', en: 'Attack' }));
  private readonly fullscreen = makeButton('mobile-fullscreen', 'FULL', mobileText({ ru: 'Полный экран', en: 'Fullscreen' }));
  private readonly actionRail = document.createElement('div');
  private readonly actionUp = makeButton('mobile-menu-btn', '▲', mobileText({ ru: 'Действие выше', en: 'Previous action' }));
  private readonly actionSelect = makeButton('mobile-menu-btn mobile-menu-select', mobileText(MOBILE_ACTIONS[0].label), mobileText(MOBILE_ACTIONS[0].ariaLabel));
  private readonly actionDown = makeButton('mobile-menu-btn', '▼', mobileText({ ru: 'Действие ниже', en: 'Next action' }));

  private enabled = false;
  private selectedAction = 0;
  private movePointer = -1;
  private lookPointer = -1;
  private firePointer = -1;
  private actionPointer = -1;
  private heldActionInput: BooleanInputKey | null = null;
  private moveActive = false;
  private lookActive = false;
  private context: MobileControlsContext = {
    started: false,
    menuOpen: false,
    canInteract: false,
    gameOver: false,
  };
  private readonly pulseTimers = new Map<BooleanInputKey, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly input: InputState,
    private readonly options: MobileControlsOptions
  ) {
    this.root.className = 'mobile-controls';
    this.root.setAttribute('aria-hidden', 'false');

    this.rotate.className = 'mobile-rotate';
    this.rotate.textContent = mobileText({ ru: 'Поверните телефон горизонтально', en: 'Rotate phone landscape' });

    this.moveThumb.className = 'mobile-pad-thumb';
    this.movePad.append(this.moveThumb);

    this.lookThumb.className = 'mobile-pad-thumb';
    this.lookPad.append(this.lookThumb);

    this.actionRail.className = 'mobile-menu-rail';
    this.actionRail.append(this.actionUp, this.actionSelect, this.actionDown);

    this.root.append(
      this.rotate,
      this.fire,
      this.fullscreen,
      this.movePad,
      this.lookPad,
      this.interact,
      this.actionRail
    );
    document.body.append(this.root);

    this.bindPad(this.movePad, this.moveThumb, 'move');
    this.bindPad(this.lookPad, this.lookThumb, 'look');
    this.holdInteractButton(this.interact);
    this.bindEvents();

    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('scroll', this.onResize);
    document.addEventListener('fullscreenchange', this.onResize);
    document.addEventListener('webkitfullscreenchange', this.onResize);

    this.refresh();
  }

  private setBool(key: BooleanInputKey, value: boolean): void {
    (this.input as unknown as Record<BooleanInputKey, boolean>)[key] = value;
  }

  private setActionInput(key: BooleanInputKey, value: boolean): void {
    if (key === 'interact') {
      this.input.interact = value ? !this.input.interactHeld : false;
      this.input.interactHeld = value;
      return;
    }
    this.setBool(key, value);
  }

  private pulse(key: BooleanInputKey): void {
    this.setActionInput(key, true);
    const old = this.pulseTimers.get(key);
    if (old) clearTimeout(old);
    this.pulseTimers.set(key, setTimeout(() => {
      this.setActionInput(key, false);
      this.pulseTimers.delete(key);
    }, 90));
  }

  private releaseHeldAction(): void {
    if (!this.heldActionInput) return;
    this.setActionInput(this.heldActionInput, false);
    this.heldActionInput = null;
    this.actionPointer = -1;
  }

  private updateTouchActive(): void {
    this.input.touch.active = this.moveActive || this.lookActive;
  }

  private syncHudSafeContext(): void {
    const active = this.enabled && this.context.started;
    const safe = computeMobileHudSafeInsets(active);
    setMobileHudSafeContext({
      enabled: active,
      portrait: safe.portrait,
      safeInsets: safe.safeInsets,
    });
    const cssInsets = safe.safeInsets ?? { top: 0, right: 0, bottom: 0, left: 0 };
    this.root.style.setProperty('--mobile-safe-top-px', `${cssInsets.top}px`);
    this.root.style.setProperty('--mobile-safe-right-px', `${cssInsets.right}px`);
    this.root.style.setProperty('--mobile-safe-bottom-px', `${cssInsets.bottom}px`);
    this.root.style.setProperty('--mobile-safe-left-px', `${cssInsets.left}px`);
  }

  private clearTouchInput(): void {
    this.input.touch.moveX = 0;
    this.input.touch.moveY = 0;
    this.input.touch.lookX = 0;
    this.input.touch.lookY = 0;
    this.input.touch.active = false;
    this.input.mouseAttack = false;
    this.releaseHeldAction();
    for (const action of MOBILE_ACTIONS) {
      if (action.kind === 'input') this.setActionInput(action.input, false);
    }
    this.moveActive = false;
    this.lookActive = false;
    this.movePointer = -1;
    this.lookPointer = -1;
    this.firePointer = -1;
    this.moveThumb.style.transform = '';
    this.lookThumb.style.transform = '';
  }

  private updateLocalizedText(): void {
    this.rotate.textContent = mobileText({ ru: 'Поверните телефон горизонтально', en: 'Rotate phone landscape' });
    this.movePad.setAttribute('aria-label', mobileText({ ru: 'Джойстик движения', en: 'Movement stick' }));
    this.lookPad.setAttribute('aria-label', mobileText({ ru: 'Джойстик камеры', en: 'Camera stick' }));
    this.interact.textContent = mobileInteractLabel();
    this.interact.setAttribute('aria-label', mobileText({ ru: 'Взаимодействие', en: 'Interact' }));
    this.fire.setAttribute('aria-label', mobileText({ ru: 'Атака', en: 'Attack' }));
    this.actionUp.setAttribute('aria-label', mobileText(this.context.menuOpen ? { ru: 'Меню выше', en: 'Menu up' } : { ru: 'Действие выше', en: 'Previous action' }));
    this.actionDown.setAttribute('aria-label', mobileText(this.context.menuOpen ? { ru: 'Меню ниже', en: 'Menu down' } : { ru: 'Действие ниже', en: 'Next action' }));
  }

  private updateSelectedLabel(): void {
    const action = MOBILE_ACTIONS[this.selectedAction];
    this.actionSelect.textContent = this.context.menuOpen
      ? (this.context.gameOver ? 'R' : mobileText({ ru: 'ЗАКР', en: 'CLOSE' }))
      : mobileText(action.label);
    this.actionSelect.setAttribute(
      'aria-label',
      this.context.menuOpen
        ? (this.context.gameOver ? mobileText({ ru: 'Перезапуск', en: 'Restart' }) : mobileText({ ru: 'Закрыть меню', en: 'Close menu' }))
        : mobileText(action.ariaLabel),
    );
  }

  private updateFullscreenUi(): void {
    const standalone = isStandaloneDisplay();
    const embedded = isEmbeddedViewport();
    const nativeFullscreen = canUseMobileFullscreen();
    const active = isMobileFullscreenActive();
    const mode = standalone ? 'standalone' : embedded ? 'direct' : nativeFullscreen ? (active ? 'exit' : 'native') : 'hidden';
    this.fullscreen.dataset.fullscreenMode = mode;
    this.fullscreen.hidden = standalone || (!embedded && !nativeFullscreen);
    this.fullscreen.textContent = embedded ? 'PAGE' : (active ? 'EXIT' : 'FULL');
    this.fullscreen.setAttribute(
      'aria-label',
      embedded
        ? mobileText({ ru: 'Открыть игру отдельной страницей', en: 'Open game in a separate page' })
        : (isMobileFullscreenActive()
          ? mobileText({ ru: 'Выйти из полного экрана', en: 'Exit fullscreen' })
          : mobileText({ ru: 'Полный экран', en: 'Fullscreen' })),
    );
  }

  private setEnabled(next: boolean): void {
    this.enabled = next;
    this.root.toggleAttribute('hidden', !this.enabled);
    document.body.classList.toggle('mobile-controls-on', this.enabled);
    if (!this.enabled) this.clearTouchInput();
    this.updateSelectedLabel();
    this.updateFullscreenUi();
    this.syncHudSafeContext();
  }

  private refreshClasses(): void {
    const portrait = window.innerHeight > window.innerWidth;
    this.root.classList.toggle('is-started', this.context.started);
    this.root.classList.toggle('is-menu-open', this.context.menuOpen);
    this.root.classList.toggle('can-interact', this.context.canInteract);
    this.root.classList.toggle('is-game-over', this.context.gameOver);
    this.root.classList.toggle('is-portrait', portrait);
    this.updateLocalizedText();
    this.updateSelectedLabel();
    this.updateFullscreenUi();
    this.syncHudSafeContext();
  }

  public refresh(): void {
    this.setEnabled(shouldUseTouchControls());
    this.refreshClasses();
  }

  private resetPad(kind: 'move' | 'look'): void {
    if (kind === 'move') {
      this.input.touch.moveX = 0;
      this.input.touch.moveY = 0;
      this.moveThumb.style.transform = '';
      this.moveActive = false;
    } else {
      this.input.touch.lookX = 0;
      this.input.touch.lookY = 0;
      this.lookThumb.style.transform = '';
      this.lookActive = false;
    }
    this.updateTouchActive();
  }

  private updatePad(el: HTMLElement, thumb: HTMLElement, kind: 'move' | 'look', e: PointerEvent): void {
    const rect = el.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.42);
    const dx = e.clientX - (rect.left + rect.width * 0.5);
    const dy = e.clientY - (rect.top + rect.height * 0.5);
    const len = Math.hypot(dx, dy);
    const scale = len > radius ? radius / len : 1;
    const nx = (dx * scale) / radius;
    const ny = (dy * scale) / radius;
    thumb.style.transform = `translate(${nx * 34}%, ${ny * 34}%)`;
    if (kind === 'move') {
      this.input.touch.moveX = nx;
      this.input.touch.moveY = -ny;
      this.moveActive = true;
    } else {
      this.input.touch.lookX = nx;
      this.input.touch.lookY = ny;
      this.lookActive = true;
    }
    this.updateTouchActive();
  }

  private bindPad(el: HTMLButtonElement, thumb: HTMLElement, kind: 'move' | 'look'): void {
    const pointerDown = (e: PointerEvent): void => {
      if (!this.enabled || !this.context.started || this.context.menuOpen || this.context.gameOver) return;
      e.preventDefault();
      e.stopPropagation();
      this.options.onGesture();
      if (kind === 'move') this.movePointer = e.pointerId; else this.lookPointer = e.pointerId;
      capturePointer(el, e.pointerId);
      this.updatePad(el, thumb, kind, e);
    };
    const pointerMove = (e: PointerEvent): void => {
      const activePointer = kind === 'move' ? this.movePointer : this.lookPointer;
      if (e.pointerId !== activePointer) return;
      e.preventDefault();
      this.updatePad(el, thumb, kind, e);
    };
    const pointerEnd = (e: PointerEvent): void => {
      const activePointer = kind === 'move' ? this.movePointer : this.lookPointer;
      if (e.pointerId !== activePointer) return;
      e.preventDefault();
      releasePointer(el, e.pointerId);
      if (kind === 'move') this.movePointer = -1; else this.lookPointer = -1;
      this.resetPad(kind);
    };
    el.addEventListener('pointerdown', pointerDown);
    el.addEventListener('pointermove', pointerMove);
    el.addEventListener('pointerup', pointerEnd);
    el.addEventListener('pointercancel', pointerEnd);
    el.addEventListener('lostpointercapture', pointerEnd);
  }

  private holdInteractButton(el: HTMLButtonElement): void {
    let interactPointer = -1;
    el.addEventListener('pointerdown', e => {
      if (!this.enabled || !this.context.started) return;
      e.preventDefault();
      e.stopPropagation();
      this.options.onGesture();
      if (this.context.menuOpen) {
        this.options.onConfirm();
        return;
      }
      interactPointer = e.pointerId;
      capturePointer(el, e.pointerId);
      this.input.interact = true;
      this.input.interactHeld = true;
    });
    const pointerEnd = (e: PointerEvent): void => {
      if (e.pointerId !== interactPointer) return;
      e.preventDefault();
      releasePointer(el, e.pointerId);
      interactPointer = -1;
      this.input.interact = false;
      this.input.interactHeld = false;
    };
    el.addEventListener('pointerup', pointerEnd);
    el.addEventListener('pointercancel', pointerEnd);
    el.addEventListener('lostpointercapture', pointerEnd);
  }

  private actionNav(dir: number): void {
    this.options.onGesture();
    if (this.context.menuOpen) {
      this.pulse(dir < 0 ? 'invUp' : 'invDn');
    } else {
      this.selectedAction = (this.selectedAction + MOBILE_ACTIONS.length + dir) % MOBILE_ACTIONS.length;
      this.updateSelectedLabel();
    }
  }

  private actionConfirm(e: PointerEvent): void {
    this.options.onGesture();
    if (this.context.gameOver) {
      this.pulse('use');
    } else if (this.context.menuOpen) {
      this.options.onClose();
    } else {
      const action = MOBILE_ACTIONS[this.selectedAction];
      if (action.kind === 'menu') {
        this.options.onMenu(action.id);
      } else if (action.hold) {
        this.actionPointer = e.pointerId;
        this.heldActionInput = action.input;
        capturePointer(this.actionSelect, e.pointerId);
        this.setActionInput(action.input, true);
      } else {
        this.pulse(action.input);
      }
    }
  }

  private bindEvents(): void {
    this.fullscreen.addEventListener('pointerdown', e => {
      if (!this.enabled || isStandaloneDisplay()) return;
      e.preventDefault();
      e.stopPropagation();
      if (isEmbeddedViewport()) {
        this.options.onGesture();
        openStandalonePage();
        return;
      }
      if (!canUseMobileFullscreen()) return;
      if (isMobileFullscreenActive()) {
        this.options.onGesture();
        void exitMobileFullscreen().finally(() => this.updateFullscreenUi());
      } else {
        const pending = enterMobileFullscreen();
        this.options.onGesture();
        void pending.finally(() => this.updateFullscreenUi());
      }
    });

    this.fire.addEventListener('pointerdown', e => {
      if (!this.enabled || !this.context.started || this.context.menuOpen || this.context.gameOver) return;
      e.preventDefault();
      e.stopPropagation();
      this.options.onGesture();
      this.firePointer = e.pointerId;
      capturePointer(this.fire, e.pointerId);
      this.input.mouseAttack = true;
    });
    const endFire = (e: PointerEvent): void => {
      if (e.pointerId !== this.firePointer) return;
      e.preventDefault();
      releasePointer(this.fire, e.pointerId);
      this.firePointer = -1;
      this.input.mouseAttack = false;
    };
    this.fire.addEventListener('pointerup', endFire);
    this.fire.addEventListener('pointercancel', endFire);
    this.fire.addEventListener('lostpointercapture', endFire);

    this.actionUp.addEventListener('pointerdown', e => {
      if (!this.enabled || !this.context.started) return;
      e.preventDefault();
      e.stopPropagation();
      this.actionNav(-1);
    });
    this.actionDown.addEventListener('pointerdown', e => {
      if (!this.enabled || !this.context.started) return;
      e.preventDefault();
      e.stopPropagation();
      this.actionNav(1);
    });
    this.actionSelect.addEventListener('pointerdown', e => {
      if (!this.enabled || !this.context.started) return;
      e.preventDefault();
      e.stopPropagation();
      this.actionConfirm(e);
    });
    const actionEnd = (e: PointerEvent): void => {
      if (e.pointerId !== this.actionPointer) return;
      e.preventDefault();
      releasePointer(this.actionSelect, e.pointerId);
      this.releaseHeldAction();
    };
    this.actionSelect.addEventListener('pointerup', actionEnd);
    this.actionSelect.addEventListener('pointercancel', actionEnd);
    this.actionSelect.addEventListener('lostpointercapture', actionEnd);
  }

  private onResize(): void {
    this.refresh();
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public resetInput(): void {
    this.clearTouchInput();
  }

  public updateContext(next: MobileControlsContext): void {
    this.context = next;
    this.refreshClasses();
  }

  public destroy(): void {
    for (const timer of this.pulseTimers.values()) clearTimeout(timer);
    window.removeEventListener('resize', this.onResize);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    window.visualViewport?.removeEventListener('scroll', this.onResize);
    document.removeEventListener('fullscreenchange', this.onResize);
    document.removeEventListener('webkitfullscreenchange', this.onResize);
    document.body.classList.remove('mobile-controls-on');
    setMobileHudSafeContext({ enabled: false, portrait: false });
    this.root.remove();
  }
}

export function createMobileControls(input: InputState, options: MobileControlsOptions): MobileControls {
  return new MobileControlsImpl(input, options);
}
