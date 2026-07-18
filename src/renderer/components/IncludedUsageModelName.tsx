import { useEffect, useRef, useState } from 'react';

interface IncludedUsageModelNameProps {
  name: string;
}

export default function IncludedUsageModelName({ name }: IncludedUsageModelNameProps) {
  const trackRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const track = trackRef.current;
    const text = textRef.current;
    if (!track || !text) return;

    const measure = () => {
      setOverflow(text.scrollWidth > track.clientWidth + 1);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [name]);

  return (
    <span ref={trackRef} className="included-usage__name-track" role="cell">
      <span className={`included-usage__name-marquee${overflow ? ' is-overflow' : ''}`}>
        <span ref={textRef} className="included-usage__row-name">
          {name}
        </span>
        {overflow && (
          <span className="included-usage__row-name" aria-hidden>
            {name}
          </span>
        )}
      </span>
    </span>
  );
}
