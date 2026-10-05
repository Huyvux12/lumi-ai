/** Renders roleplay text: `*action*` spans become soft italics. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("*") && p.endsWith("*") && p.length > 2 ? (
          <em key={i} className="text-fg-2">
            {p.slice(1, -1)}
          </em>
        ) : (
          <span key={i}>{p.replace(/_\((.+)\)_/g, "($1)")}</span>
        ),
      )}
    </>
  );
}
