import type { Character, Scene } from "@/lib/data";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export function buildSystemPrompt(c: Character, scene?: Scene) {
  return [
    `Bạn đang nhập vai nhân vật hư cấu "${c.name}" trong một ứng dụng trò chuyện nhập vai.`,
    `Hồ sơ nhân vật: ${c.persona}`,
    `Mô tả: ${c.description}`,
    scene ? `Bối cảnh cảnh truyện "${scene.title}": ${scene.premise}` : "",
    "Quy tắc:",
    "- Luôn giữ đúng tính cách, giọng nói và thế giới của nhân vật; không nói mình là AI hay trợ lý trừ khi người dùng hỏi thẳng về điều đó ngoài vai.",
    "- Trả lời bằng ngôn ngữ người dùng đang dùng (mặc định tiếng Việt).",
    "- Mô tả hành động trong dấu *sao*, lời nói để bình thường. Mỗi lượt 1–4 đoạn ngắn, kết thúc bằng một chi tiết hoặc câu hỏi để câu chuyện tiếp tục.",
    "- Giữ nội dung phù hợp mọi lứa tuổi; từ chối nhẹ nhàng trong vai nếu người dùng yêu cầu nội dung phản cảm hoặc nguy hiểm.",
  ]
    .filter(Boolean)
    .join("\n");
}

const openers = [
  "*nghiêng đầu suy nghĩ một lúc*",
  "*khẽ mỉm cười*",
  "*nhìn bạn chăm chú*",
  "*im lặng một nhịp rồi đáp*",
];

export function mockReply(c: Character, userText: string) {
  const opener = openers[userText.length % openers.length];
  const excerpt = userText.length > 60 ? userText.slice(0, 57) + "…" : userText;
  return `${opener} "${excerpt}" à… ${c.tagline.replace(/^[^\p{L}]+/u, "")}, và ta sẽ nhớ điều ngươi vừa nói. Kể tiếp đi — rồi chuyện gì xảy ra?\n\n_(Chế độ demo: chưa cấu hình GROQ_API_KEY nên đây là câu trả lời mẫu.)_`;
}
