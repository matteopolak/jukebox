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

export const enum SongProvider {
	YouTube,
	Spotify,
	SoundCloud,
}

export interface SongData {
	url: string;
	id: string;
	title: string;
	duration: string;
	thumbnail: string;
	live: boolean;
	type: SongProvider;
	format?: videoFormat;
	related?: string;
}

export interface Song extends SongData {
	addedAt: number;
	guildId: string;
}

export interface StarredData {
	id: string;
	guildId: string;
}

export const enum Effect {
	None,
	Loud,
	UnderWater,
	Bass,
	Echo,
	HighPitch,
	Reverse,
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

export interface SearchResult {
	videos: SongData[];
	title: Option<string>;
}

export interface ConnectionSettings {
	effect: Effect;
	repeat: boolean;
	autoplay: boolean;
	seek: number;
	shuffle: boolean;
}

export type Option<T> = T | null;
export type WithId<T> = T & { _id: string };
