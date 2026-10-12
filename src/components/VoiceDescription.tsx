import type { Voice } from "@/lib/chat/speech";

export function VoiceDescription({ voice }: { voice?: Voice }) {
  if (!voice) return null;
  return (
    <p className="w-full text-xs text-fg-2" aria-live="polite" data-testid="voice-description">
      <span lang="vi">{voice.description_vi}</span>
      <br />
      <span lang="en">{voice.description_en}</span>
    </p>
  );
}
