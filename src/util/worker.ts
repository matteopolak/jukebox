import {
	Client,
	IntentsBitField,
	NewsChannel,
	Options,
	Partials,
	TextChannel,
} from 'discord.js';
import dotenv from 'dotenv';

dotenv.config({ override: true });

export const MAIN_CLIENT = new Client({
	partials: [Partials.GuildMember, Partials.User, Partials.Channel],
	makeCache: Options.cacheWithLimits({
		ApplicationCommandManager: 0,
		BaseGuildEmojiManager: 0,
		GuildBanManager: 0,
		GuildInviteManager: 0,
		GuildMemberManager: 100,
		GuildStickerManager: 0,
		GuildScheduledEventManager: 0,
		MessageManager: 0,
		PresenceManager: 0,
		ReactionManager: 0,
		ReactionUserManager: 0,
		StageInstanceManager: 0,
		ThreadManager: 0,
		ThreadMemberManager: 0,
		UserManager: Infinity,
		VoiceStateManager: Infinity,
	}),
	intents: [
		IntentsBitField.Flags.Guilds,
		IntentsBitField.Flags.GuildMessages,
		IntentsBitField.Flags.MessageContent,
		IntentsBitField.Flags.GuildVoiceStates,
	],
});

export const LYRICS_CLIENT = new Client({
	partials: [Partials.GuildMember, Partials.User, Partials.Channel],
	makeCache: Options.cacheWithLimits({
		ApplicationCommandManager: 0,
		BaseGuildEmojiManager: 0,
		GuildBanManager: 0,
		GuildInviteManager: 0,
		GuildMemberManager: 100,
		GuildStickerManager: 0,
		GuildScheduledEventManager: 0,
		MessageManager: 0,
		PresenceManager: 0,
		ReactionManager: 0,
		ReactionUserManager: 0,
		StageInstanceManager: 0,
		ThreadManager: Infinity,
		ThreadMemberManager: 0,
		UserManager: 0,
		VoiceStateManager: 0,
	}),
	intents: [IntentsBitField.Flags.Guilds],
});

export const QUEUE_CLIENT = new Client({
	partials: [Partials.GuildMember, Partials.User, Partials.Channel],
	makeCache: Options.cacheWithLimits({
		ApplicationCommandManager: 0,
		BaseGuildEmojiManager: 0,
		GuildBanManager: 0,
		GuildInviteManager: 0,
		GuildMemberManager: 100,
		GuildStickerManager: 0,
		GuildScheduledEventManager: 0,
		MessageManager: 0,
		PresenceManager: 0,
		ReactionManager: 0,
		ReactionUserManager: 0,
		StageInstanceManager: 0,
		ThreadManager: 0,
		ThreadMemberManager: 0,
		UserManager: 0,
		VoiceStateManager: 0,
	}),
	intents: [IntentsBitField.Flags.Guilds],
});

function loginAndWait(client: Client, token: string) {
	client.login(token);

	return new Promise(r => client.once('ready', r));
}

export const loginPromise = Promise.all([
	loginAndWait(MAIN_CLIENT, process.env.MAIN_TOKEN!),
	loginAndWait(LYRICS_CLIENT, process.env.LYRICS_TOKEN!),
	loginAndWait(QUEUE_CLIENT, process.env.QUEUE_TOKEN!),
]);

export function getChannel(
	client: Client,
	guildId: string,
	channelId: string
): TextChannel | NewsChannel {
	return client.guilds.cache.get(guildId)!.channels.cache.get(channelId)! as
		| TextChannel
		| NewsChannel;
}
