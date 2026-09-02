import React, { useState, useEffect } from 'react';

export interface EmojiItem {
  id: string;
  emoji: string;
  x: number;
  y: number;
  createdAt: number;
}

interface EmojiBurstProps {
  emojis: EmojiItem[];
  onDone: (id: string) => void;
}

/**
 * Renders animated emojis that float up and fade out.
 * Used for gesture-triggered reactions (thumb up → smile emoji).
 */
export const EmojiBurst: React.FC<EmojiBurstProps> = ({ emojis, onDone }) => {
  return (
    <div className="emoji-burst-layer">
      {emojis.map((item) => (
        <FloatingEmoji
          key={item.id}
          item={item}
          onDone={() => onDone(item.id)}
        />
      ))}
    </div>
  );
};

const FLOAT_DURATION = 2000; // ms

const FloatingEmoji: React.FC<{ item: EmojiItem; onDone: () => void }> = ({
  item,
  onDone,
}) => {
  const [opacity, setOpacity] = useState(1);
  const [offsetY, setOffsetY] = useState(0);

  useEffect(() => {
    const start = performance.now();

    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / FLOAT_DURATION, 1);

      // Float upward 120px, fade out in last 40%
      setOffsetY(-120 * progress);
      setOpacity(progress > 0.6 ? 1 - (progress - 0.6) / 0.4 : 1);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        onDone();
      }
    };

    requestAnimationFrame(animate);
  }, [onDone]);

  return (
    <div
      className="floating-emoji"
      style={{
        left: item.x,
        top: item.y,
        opacity,
        transform: `translate(-50%, -50%) translateY(${offsetY}px) scale(${1 + (1 - opacity) * 0.5})`,
      }}
    >
      {item.emoji}
    </div>
  );
};
