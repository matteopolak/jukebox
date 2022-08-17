import { PlayerSubscription, AudioResource } from '@discordjs/voice';
import {
	ButtonInteraction,
	Guild,
	GuildMember,
	TextBasedChannel,
} from 'discord.js';

export interface RawManager {
	_id: string;
	messageId: string;
	queueId: string;
	channelId: string;
	guildId: string;
}

export interface Manager extends RawManager {
	starred: Set<string>;
}

export interface Song {
	url: string;
	id: string;
	title: string;
	duration: string;
	thumbnail: string;
	live: boolean;
	format?: videoFormat;
	related?: string;
}

export const enum Effect {
	NONE,
	LOUD,
	UNDER_WATER,
	BASS,
	ECHO,
	HIGH_PITCH,
	REVERSE,
}

export interface Connection {
	subscription: PlayerSubscription | null;
	resource: AudioResource | null;
	queue: Song[];
	effect: Effect;
	repeat: boolean;
	autoplay: boolean;
	index: number;
	update: (
		song?: Song | null,
		force?: boolean,
		forceQueue?: boolean,
		interaction?: ButtonInteraction
	) => Awaited<void>;
	seek?: number;
	manager: Manager;
	voiceChannelId: string;
}

export interface RawData {
	channel: TextBasedChannel;
	guildId: string;
	guild: Guild;
	member: GuildMember;
}
