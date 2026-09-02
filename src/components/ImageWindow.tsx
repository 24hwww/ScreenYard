import React from 'react';
import { ImageData } from '../windows/types';

interface ImageWindowProps {
  data: ImageData;
  windowId: string;
}

export const ImageWindow: React.FC<ImageWindowProps> = ({ data }) => {
  if (!data.src) {
    return (
      <div className="image-window image-window--empty">
        <div className="image-placeholder">
          <span>🖼️</span>
          <span>No image loaded</span>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            Add an image URL via props
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="image-window">
      <img
        src={data.src}
        alt={data.alt}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          borderRadius: 4,
        }}
        draggable={false}
      />
    </div>
  );
};
