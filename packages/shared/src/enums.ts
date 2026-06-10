export enum Role {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

export enum MessageType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  FILE = 'FILE',
  VOICE = 'VOICE',
}

export enum MessageStatus {
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  SEEN = 'SEEN',
}

export enum ReactionEmoji {
  LIKE = 'LIKE',
  DISLIKE = 'DISLIKE',
  PRAY = 'PRAY',
  OK = 'OK',
  ROSE = 'ROSE',
}

export const REACTION_EMOJI_MAP: Record<ReactionEmoji, string> = {
  [ReactionEmoji.LIKE]: '👍',
  [ReactionEmoji.DISLIKE]: '👎',
  [ReactionEmoji.PRAY]: '🙏',
  [ReactionEmoji.OK]: '👌',
  [ReactionEmoji.ROSE]: '🌹',
};

export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

export const GENDER_LABEL: Record<Gender, string> = {
  [Gender.MALE]: 'مرد',
  [Gender.FEMALE]: 'زن',
  [Gender.OTHER]: 'سایر',
};
