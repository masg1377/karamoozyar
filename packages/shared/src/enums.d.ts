export declare enum Role {
  USER = "USER",
  ADMIN = "ADMIN",
}
export declare enum MessageType {
  TEXT = "TEXT",
  IMAGE = "IMAGE",
  FILE = "FILE",
  VOICE = "VOICE",
}
export declare enum MessageStatus {
  SENT = "SENT",
  DELIVERED = "DELIVERED",
  SEEN = "SEEN",
}
export declare enum ReactionEmoji {
  LIKE = "LIKE",
  DISLIKE = "DISLIKE",
  PRAY = "PRAY",
  OK = "OK",
  ROSE = "ROSE",
}
export declare const REACTION_EMOJI_MAP: Record<ReactionEmoji, string>;
export declare enum Gender {
  MALE = "MALE",
  FEMALE = "FEMALE",
  OTHER = "OTHER",
}
export declare const GENDER_LABEL: Record<Gender, string>;
