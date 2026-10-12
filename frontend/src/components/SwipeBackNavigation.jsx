import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Thresholds for a deliberate two-finger swipe, so a scroll, a pinch, or a
// slow drag is never mistaken for navigation.
const MIN_DISTANCE = 80;
const MAX_VERTICAL_DRIFT = 60;
const HORIZONTAL_RATIO = 2;
const MAX_SPREAD_CHANGE = 40;
const MAX_DURATION = 1000;
const COOLDOWN = 700;

// Anything the user can type in, press, open, or pan sideways keeps its own
// touch behaviour. The top navigation and any open dialog are excluded whole.
const PROTECTED = [
  'input',
  'textarea',
  'select',
  'button',
  'a',
  'label',
  'option',
  'summary',
  'img',
  'video',
  'canvas',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '.app-nav',
  '.modal-backdrop',
  '[data-swipe-back="ignore"]'
].join(', ');

function centre(touches) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2
  };
}

function spread(touches) {
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );
}

function isProtected(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target.closest(PROTECTED)) {
    return true;
  }
  // A container that can be panned sideways owns horizontal gestures, so a
  // wide table or a scrolling strip never navigates away.
  for (let node = target; node instanceof Element; node = node.parentElement) {
    const { overflowX } = window.getComputedStyle(node);
    if ((overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1) {
      return true;
    }
  }
  return false;
}

/**
 * Global two-finger swipe-right shortcut for Back on touch devices. It is an
 * extra way to do what the browser Back button and the in-page back links
 * already do, and it reuses the same history check as BackLink so it can never
 * leave the application. Renders nothing.
 */
export default function SwipeBackNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  // Read at gesture time so the listeners are registered only once.
  const canGoBack = useRef(false);
  canGoBack.current = Boolean(location.key) && location.key !== 'default';

  useEffect(() => {
    // Touch input only. A trackpad two-finger swipe produces wheel events, so
    // native browser back navigation is left exactly as it is.
    const touchCapable = navigator.maxTouchPoints > 1 || 'ontouchstart' in window;
    if (!touchCapable) {
      return undefined;
    }

    const gesture = { active: false, startX: 0, startY: 0, lastX: 0, lastY: 0, startSpread: 0, startedAt: 0 };
    let lastNavigationAt = 0;

    function onTouchStart(event) {
      // Only a clean two-finger start counts; a third finger cancels.
      if (event.touches.length !== 2) {
        gesture.active = false;
        return;
      }
      if (Date.now() - lastNavigationAt < COOLDOWN || isProtected(event.target)) {
        gesture.active = false;
        return;
      }
      const point = centre(event.touches);
      gesture.active = true;
      gesture.startX = point.x;
      gesture.startY = point.y;
      gesture.lastX = point.x;
      gesture.lastY = point.y;
      gesture.startSpread = spread(event.touches);
      gesture.startedAt = Date.now();
    }

    function onTouchMove(event) {
      if (!gesture.active) {
        return;
      }
      if (event.touches.length !== 2) {
        gesture.active = false;
        return;
      }
      const point = centre(event.touches);
      gesture.lastX = point.x;
      gesture.lastY = point.y;
      // Fingers closing or spreading is a zoom, never navigation.
      if (Math.abs(spread(event.touches) - gesture.startSpread) > MAX_SPREAD_CHANGE) {
        gesture.active = false;
      }
    }

    function onTouchEnd() {
      if (!gesture.active) {
        return;
      }
      gesture.active = false;

      const dx = gesture.lastX - gesture.startX;
      const dy = gesture.lastY - gesture.startY;
      const selection = window.getSelection();

      if (Date.now() - gesture.startedAt > MAX_DURATION) {
        return;
      }
      if (dx < MIN_DISTANCE || Math.abs(dy) > MAX_VERTICAL_DRIFT) {
        return;
      }
      // Ambiguous between horizontal and vertical means do nothing.
      if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_RATIO) {
        return;
      }
      if (selection && !selection.isCollapsed) {
        return;
      }
      if (!canGoBack.current) {
        return;
      }

      lastNavigationAt = Date.now();
      navigate(-1);
    }

    function onTouchCancel() {
      gesture.active = false;
    }

    // Passive listeners: vertical scrolling and pinch zoom stay untouched.
    const options = { passive: true };
    window.addEventListener('touchstart', onTouchStart, options);
    window.addEventListener('touchmove', onTouchMove, options);
    window.addEventListener('touchend', onTouchEnd, options);
    window.addEventListener('touchcancel', onTouchCancel, options);

    return () => {
      window.removeEventListener('touchstart', onTouchStart, options);
      window.removeEventListener('touchmove', onTouchMove, options);
      window.removeEventListener('touchend', onTouchEnd, options);
      window.removeEventListener('touchcancel', onTouchCancel, options);
    };
  }, [navigate]);

  return null;
}
