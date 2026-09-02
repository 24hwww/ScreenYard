import React from 'react';
import { ShapeData } from '../windows/types';

interface ShapeWindowProps {
  data: ShapeData;
  windowId: string;
}

export const ShapeWindow: React.FC<ShapeWindowProps> = ({ data }) => {
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const shapeStyle: React.CSSProperties = {
    width: '80%',
    height: '80%',
    backgroundColor: data.fill,
    border: data.stroke
      ? `${data.strokeWidth ?? 2}px solid ${data.stroke}`
      : 'none',
  };

  switch (data.shapeType) {
    case 'rect':
      return (
        <div className="shape-window" style={style}>
          <div style={{ ...shapeStyle, borderRadius: 4 }} />
        </div>
      );
    case 'circle':
      return (
        <div className="shape-window" style={style}>
          <div style={{ ...shapeStyle, borderRadius: '50%' }} />
        </div>
      );
    case 'triangle':
      return (
        <div className="shape-window" style={style}>
          <svg viewBox="0 0 100 100" style={{ width: '80%', height: '80%' }}>
            <polygon
              points="50,5 95,95 5,95"
              fill={data.fill}
              stroke={data.stroke ?? 'none'}
              strokeWidth={data.strokeWidth ?? 2}
            />
          </svg>
        </div>
      );
  }
};
