import React, { useRef, useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import gsap from 'gsap';
import { WindowData, TextData, ImageData, ShapeData, TabData } from '../windows/types';
import { TextWindow } from './TextWindow';
import { ImageWindow } from './ImageWindow';
import { ShapeWindow } from './ShapeWindow';
import { TabWindow } from './TabWindow';

interface WindowWrapperProps {
  window: WindowData;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onBringToFront: (id: string) => void;
  onToggleLock: (id: string) => void;
  onRemove: (id: string) => void;
  /** Called when a window's type-specific data changes (e.g. text edited) */
  onEditEnd?: (id: string, content: string) => void;
  /** Called when mouse drag starts */
  onDragStart?: (id: string) => void;
  /** Called when mouse drag ends, with final position */
  onDragEnd?: (id: string, x: number, y: number) => void;
  /** Swipe-to-delete progress (0-1) for visual feedback */
  swipeProgress?: number;
  /** Whether this element is currently being pinched (grabbed by gesture) */
  isPinched?: boolean;
  /** Pinch cursor position in stage coordinates (0-1 normalized), null if no hand */
  pinchCursor?: { x: number; y: number } | null;
  /** Pinch proximity 0-1 (how close fingers are to pinching) */
  pinchProximity?: number;
}

export const WindowWrapper: React.FC<WindowWrapperProps> = ({
  window: win,
  onSelect,
  onMove,
  onResize,
  onBringToFront,
  onToggleLock,
  onRemove,
  onEditEnd,
  onDragStart,
  onDragEnd,
  swipeProgress = 0,
  isPinched = false,
  pinchCursor = null,
  pinchProximity = 0,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, winX: 0, winY: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const wasPinchedRef = useRef(false);
  const magneticTweenRef = useRef<gsap.core.Tween | null>(null);

  // ─── GSAP paper crumple effect on pinch ───
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;

    if (isPinched && !wasPinchedRef.current) {
      // Pinch started → dramatic crumple effect
      wasPinchedRef.current = true;
      // Kill any magnetic tween
      if (magneticTweenRef.current) {
        magneticTweenRef.current.kill();
        magneticTweenRef.current = null;
      }
      gsap.killTweensOf(inner);
      gsap.to(inner, {
        scale: 0.85,
        rotation: 3,
        skewX: 4,
        skewY: -2,
        borderRadius: '12px',
        duration: 0.25,
        ease: 'power3.out',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6), inset 0 0 30px rgba(0,0,0,0.2)',
        x: 0,
        y: 0,
      });
      // Wobble for paper-like feel
      gsap.to(inner, {
        rotation: -2,
        duration: 0.15,
        ease: 'power2.inOut',
        yoyo: true,
        repeat: 3,
        delay: 0.25,
      });
    } else if (!isPinched && wasPinchedRef.current) {
      // Pinch released → spring back with elastic bounce
      wasPinchedRef.current = false;
      gsap.killTweensOf(inner);
      gsap.to(inner, {
        scale: 1,
        rotation: 0,
        skewX: 0,
        skewY: 0,
        borderRadius: '0px',
        x: 0,
        y: 0,
        duration: 0.6,
        ease: 'elastic.out(1, 0.4)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
      });
    }
  }, [isPinched]);

  // ─── GSAP magnetic effect: attract element toward pinch cursor ───
  // When the pinch cursor is near this element (but not yet pinching),
  // the element subtly pulls toward the cursor like a magnet.
  useEffect(() => {
    if (isPinched || win.locked) {
      // Reset magnetic offset when pinched or locked
      if (magneticTweenRef.current) {
        magneticTweenRef.current.kill();
        magneticTweenRef.current = null;
      }
      if (!wasPinchedRef.current && innerRef.current) {
        gsap.to(innerRef.current, { x: 0, y: 0, duration: 0.3, ease: 'power2.out' });
      }
      return;
    }

    const wrapper = wrapperRef.current;
    const inner = innerRef.current;
    if (!wrapper || !inner || !pinchCursor) {
      // No cursor → reset
      if (magneticTweenRef.current) {
        magneticTweenRef.current.kill();
        magneticTweenRef.current = null;
      }
      gsap.to(inner, { x: 0, y: 0, duration: 0.4, ease: 'power2.out' });
      return;
    }

    // Get element center in screen coordinates
    const rect = wrapper.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Pinch cursor in screen coordinates (normalized 0-1 → screen)
    const stage = wrapper.closest('.stage');
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const cursorX = stageRect.left + pinchCursor.x * stageRect.width;
    const cursorY = stageRect.top + pinchCursor.y * stageRect.height;

    // Distance from cursor to element center
    const dx = cursorX - cx;
    const dy = cursorY - cy;
    const dist = Math.hypot(dx, dy);

    // Magnetic range: 150px. Only attract when within range.
    const MAGNETIC_RANGE = 150;
    if (dist > MAGNETIC_RANGE) {
      // Out of range → reset position
      if (magneticTweenRef.current) {
        magneticTweenRef.current.kill();
        magneticTweenRef.current = null;
      }
      gsap.to(inner, { x: 0, y: 0, duration: 0.4, ease: 'power2.out' });
      return;
    }

    // Magnetic strength: closer = stronger pull
    // Max pull: 20px toward cursor. Scale by proximity (pinch closeness).
    const proximityFactor = Math.max(pinchProximity, 0.3); // min 0.3 so hover also attracts
    const strength = (1 - dist / MAGNETIC_RANGE) * 20 * proximityFactor;
    const angle = Math.atan2(dy, dx);
    const targetX = Math.cos(angle) * strength;
    const targetY = Math.sin(angle) * strength;

    // Kill previous tween and animate to new magnetic position
    if (magneticTweenRef.current) {
      magneticTweenRef.current.kill();
    }
    magneticTweenRef.current = gsap.to(inner, {
      x: targetX,
      y: targetY,
      duration: 0.2,
      ease: 'power2.out',
      overwrite: 'auto',
    });
  }, [pinchCursor, pinchProximity, isPinched, win.locked, win.position.x, win.position.y]);

  // Mouse drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (win.locked) return;
      if ((e.target as HTMLElement).classList.contains('resize-handle')) return;
      e.stopPropagation();
      onSelect(win.id);
      onBringToFront(win.id);
      setIsDragging(true);
      onDragStart?.(win.id);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        winX: win.position.x,
        winY: win.position.y,
      };
    },
    [win, onSelect, onBringToFront, onDragStart],
  );

  // Resize handle
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (win.locked) return;
      e.stopPropagation();
      e.preventDefault();
      setIsResizing(true);
      resizeStart.current = {
        x: e.clientX,
        y: e.clientY,
        w: win.size.width,
        h: win.size.height,
      };
    },
    [win],
  );

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        const newX = dragStart.current.winX + dx;
        const newY = dragStart.current.winY + dy;
        onMove(win.id, newX, newY);
      }
      if (isResizing) {
        const dx = e.clientX - resizeStart.current.x;
        const dy = e.clientY - resizeStart.current.y;
        const newW = Math.max(80, resizeStart.current.w + dx);
        const newH = Math.max(60, resizeStart.current.h + dy);
        onResize(win.id, newW, newH);
      }
    };

    const handleMouseUp = () => {
      if (isDragging) {
        const finalX = dragStart.current.winX;
        const finalY = dragStart.current.winY;
        onDragEnd?.(win.id, finalX, finalY);
      }
      setIsDragging(false);
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, win.id, onMove, onResize, onDragEnd]);

  const renderContent = () => {
    switch (win.type) {
      case 'text':
        return (
          <TextWindow
            data={win.data as TextData}
            windowId={win.id}
            isEditing={win.editing}
            onEditEnd={(content) => onEditEnd?.(win.id, content)}
          />
        );
      case 'image':
        return <ImageWindow data={win.data as ImageData} windowId={win.id} />;
      case 'shape':
        return <ShapeWindow data={win.data as ShapeData} windowId={win.id} />;
      case 'tab':
        return <TabWindow data={win.data as TabData} windowId={win.id} />;
      default:
        return <div className="window-fallback">{win.type}</div>;
    }
  };

  // Compute 3D tilt based on state
  const isActive = isDragging || swipeProgress > 0;
  const tiltX = isDragging ? -8 : 0; // tilt up when dragging
  const tiltY = swipeProgress > 0 ? swipeProgress * 30 : 0; // tilt sideways during swipe

  // Animation variants
  const motionStyle: React.CSSProperties = {
    left: win.position.x,
    top: win.position.y,
    width: win.size.width,
    height: win.size.height,
    zIndex: win.zIndex,
    cursor: win.locked ? 'default' : isDragging ? 'grabbing' : 'grab',
  };

  return (
    <motion.div
      ref={wrapperRef}
      className={`window-wrapper ${win.selected ? 'window-wrapper--selected' : ''} ${win.locked ? 'window-wrapper--locked' : ''} ${isDragging ? 'window-wrapper--dragging' : ''} ${swipeProgress > 0 ? 'window-wrapper--swiping' : ''} ${win.editing ? 'window-wrapper--editing' : ''}`}
      style={motionStyle}
      initial={{ opacity: 0, scale: 0.5, rotateY: -90 }}
      animate={{
        opacity: 1 - swipeProgress * 0.7,
        scale: isActive ? 1 - swipeProgress * 0.15 : (win.selected ? 1.03 : (isHovered ? 1.02 : 1)),
        rotateX: tiltX,
        rotateY: tiltY,
        boxShadow: win.selected
          ? swipeProgress > 0
            ? `0 0 ${swipeProgress * 40}px rgba(239, 68, 68, ${swipeProgress * 0.9}), 0 0 0 2px #3b82f6, 0 8px 32px rgba(59, 130, 246, 0.4)`
            : '0 0 0 2px #3b82f6, 0 8px 32px rgba(59, 130, 246, 0.4)'
          : swipeProgress > 0
            ? `0 0 ${swipeProgress * 40}px rgba(239, 68, 68, ${swipeProgress * 0.9}), 0 4px 20px rgba(0,0,0,0.3)`
            : isDragging
              ? '0 12px 40px rgba(0, 0, 0, 0.5)'
              : '0 2px 12px rgba(0, 0, 0, 0.25)',
        filter: swipeProgress > 0
          ? `hue-rotate(${swipeProgress * -60}deg) brightness(${1 + swipeProgress * 0.3})`
          : win.editing
            ? 'brightness(1.1)'
            : 'none',
      }}
      exit={{
        opacity: 0,
        scale: 0.3,
        rotateX: 90,
        transition: { duration: 0.3, ease: 'easeIn' },
      }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 30,
        opacity: { duration: 0.2 },
        boxShadow: { duration: 0.2 },
      }}
      whileHover={win.locked ? undefined : { scale: win.selected ? 1.03 : 1.02 }}
      whileTap={win.locked ? undefined : { scale: 0.98 }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div ref={innerRef} className="window-inner" style={{ width: '100%', height: '100%', position: 'relative' }}>
        {renderContent()}
      </div>

      {win.selected && !win.locked && (
        <motion.div
          className="window-selection-border"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        />
      )}

      {win.selected && (
        <motion.div
          className="window-controls"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 20 }}
        >
          <button
            className="window-control-btn"
            title={win.locked ? 'Unlock' : 'Lock'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleLock(win.id);
            }}
          >
            {win.locked ? '🔒' : '🔓'}
          </button>
          <button
            className="window-control-btn window-control-btn--danger"
            title="Remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(win.id);
            }}
          >
            ✕
          </button>
        </motion.div>
      )}

      {win.selected && !win.locked && (
        <div
          className="resize-handle"
          onMouseDown={handleResizeMouseDown}
        />
      )}
    </motion.div>
  );
};
