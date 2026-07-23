import { Disc3 } from "lucide-react";

export function CoverArt({
  src,
  alt,
  className = "",
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  return src ? (
    <img className={`cover ${className}`} src={src} alt={alt} />
  ) : (
    <div className={`cover vinyl ${className}`} role="img" aria-label={alt}>
      <Disc3 />
    </div>
  );
}

export function PlaylistCollage({
  urls,
  title,
}: {
  urls: (string | null)[];
  title: string;
}) {
  const populated = urls.filter(Boolean).slice(0, 4) as string[];
  if (!populated.length) return <CoverArt src={null} alt={title} />;
  while (populated.length < 4)
    populated.push(populated[populated.length % Math.max(1, populated.length)]);
  return (
    <div className="cover collage" aria-label={title}>
      {populated.map((url, index) => (
        <img key={`${url}-${index}`} src={url} alt="" />
      ))}
    </div>
  );
}
