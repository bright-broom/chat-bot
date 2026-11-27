// チャット API で共有する型

export type Role = "user" | "assistant";
export type ChatMessage = { role: Role; content: string };

/** "chat": 通常の行政相談 / "support": 状況を聞き取って使える支援制度を案内する（AI インタビュー） */
export type Mode = "chat" | "support";

/** モデルに渡すメッセージ（system を含む） */
export type ModelMessage = { role: "system" | Role; content: string };
