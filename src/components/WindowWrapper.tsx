import React, { useRef, useState, useCallback, useEffect } from 'react';
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
        // Calculate final position
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

  return (
    <div
      ref={wrapperRef}
      className={`window-wrapper ${win.selected ? 'window-wrapper--selected' : ''} ${win.locked ? 'window-wrapper--locked' : ''} ${isDragging ? 'window-wrapper--dragging' : ''} ${swipeProgress > 0 ? 'window-wrapper--swiping' : ''}`}
      style={{
        left: win.position.x,
        top: win.position.y,
        width: win.size.width,
        height: win.size.height,
        zIndex: win.zIndex,
        cursor: win.locked ? 'default' : isDragging ? 'grabbing' : 'grab',
        opacity: 1 - swipeProgress * 0.6,
        transform: `scale(${1 - swipeProgress * 0.15})`,
        filter: swipeProgress > 0 ? `hue-rotate(${swipeProgress * -60}deg) brightness(${1 + swipeProgress * 0.3})` : undefined,
        boxShadow: swipeProgress > 0
          ? `0 0 ${swipeProgress * 30}px rgba(239, 68, 68, ${swipeProgress * 0.8})`
          : undefined,
      }}
      onMouseDown={handleMouseDown}
    >
      {renderContent()}

      {win.selected && !win.locked && (
        <div className="window-selection-border" />
      )}

      {win.selected && (
        <div className="window-controls">
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
        </div>
      )}

      {win.selected && !win.locked && (
        <div
          className="resize-handle"
          onMouseDown={handleResizeMouseDown}
        />
      )}
    </div>
  );
};
