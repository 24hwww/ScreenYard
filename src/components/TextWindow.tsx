import React, { useState, useRef, useEffect } from 'react';
import { TextData } from '../windows/types';

interface TextWindowProps {
  data: TextData;
  windowId: string;
  /** When true, the text window enters editing mode (controlled from parent) */
  isEditing?: boolean;
  /** Called when editing finishes, to sync content back */
  onEditEnd?: (content: string) => void;
}

export const TextWindow: React.FC<TextWindowProps> = ({
  data,
  windowId,
  isEditing: externalEditing,
  onEditEnd,
}) => {
  const [internalEditing, setInternalEditing] = useState(false);
  const [content, setContent] = useState(data.content);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sync content from props when not editing
  useEffect(() => {
    if (!internalEditing && externalEditing !== true) {
      setContent(data.content);
    }
  }, [data.content, internalEditing, externalEditing]);

  const editing = externalEditing ?? internalEditing;

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInternalEditing(true);
  };

  const finishEditing = () => {
    setInternalEditing(false);
    onEditEnd?.(content);
  };

  const handleBlur = () => {
    finishEditing();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      finishEditing();
    }
  };

  if (editing) {
    return (
      <div className="text-window text-window--editing">
        <textarea
          ref={inputRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          style={{
            fontSize: data.fontSize,
            color: data.color,
            fontFamily: data.fontFamily,
          }}
          className="text-window-input"
        />
      </div>
    );
  }

  return (
    <div
      className="text-window"
      onDoubleClick={handleDoubleClick}
      style={{
        fontSize: data.fontSize,
        color: data.color,
        fontFamily: data.fontFamily,
      }}
    >
      {content}
    </div>
  );
};
