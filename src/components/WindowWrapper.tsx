import React, { useRef, useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { WindowData, TextData, ImageData, ShapeData } from '../windows/types';
import { TextWindow } from './TextWindow';
import { ImageWindow } from './ImageWindow';
import { ShapeWindow } from './ShapeWindow';

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
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, winX: 0, winY: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

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
      {renderContent()}

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
