"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REACTION_EMOJI_MAP = exports.ReactionEmoji = exports.MessageStatus = exports.MessageType = exports.Role = void 0;
var Role;
(function (Role) {
    Role["USER"] = "USER";
    Role["ADMIN"] = "ADMIN";
})(Role || (exports.Role = Role = {}));
var MessageType;
(function (MessageType) {
    MessageType["TEXT"] = "TEXT";
    MessageType["IMAGE"] = "IMAGE";
    MessageType["FILE"] = "FILE";
    MessageType["VOICE"] = "VOICE";
})(MessageType || (exports.MessageType = MessageType = {}));
var MessageStatus;
(function (MessageStatus) {
    MessageStatus["SENT"] = "SENT";
    MessageStatus["DELIVERED"] = "DELIVERED";
    MessageStatus["SEEN"] = "SEEN";
})(MessageStatus || (exports.MessageStatus = MessageStatus = {}));
var ReactionEmoji;
(function (ReactionEmoji) {
    ReactionEmoji["LIKE"] = "LIKE";
    ReactionEmoji["DISLIKE"] = "DISLIKE";
    ReactionEmoji["PRAY"] = "PRAY";
    ReactionEmoji["OK"] = "OK";
    ReactionEmoji["ROSE"] = "ROSE";
})(ReactionEmoji || (exports.ReactionEmoji = ReactionEmoji = {}));
exports.REACTION_EMOJI_MAP = {
    [ReactionEmoji.LIKE]: '👍',
    [ReactionEmoji.DISLIKE]: '👎',
    [ReactionEmoji.PRAY]: '🙏',
    [ReactionEmoji.OK]: '👌',
    [ReactionEmoji.ROSE]: '🌹',
};
//# sourceMappingURL=enums.js.map