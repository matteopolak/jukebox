import { Guild, GuildMember, TextBasedChannel } from 'discord.js';
import { videoFormat } from 'ytdl-core';

export interface RawManager {
	_id: string;
	messageId: string;
	queueId: string;
	channelId: string;
	guildId: string;
	threadId?: string;
	lyricsId?: string;
	settings: ConnectionSettings;
	index: number;
}

export interface ConnectionSettings {
	effect: Effect;
	repeat: boolean;
	autoplay: boolean;
	seek: number;
	shuffle: boolean;
	lyrics: boolean;
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
	artist: string;
	duration: string;
	thumbnail: string;
	live: boolean;
	type: SongProvider;
	format?: Option<videoFormat>;
	related?: string;
	musixmatchId?: Option<number>;
	geniusId?: Option<number>;
}

export interface Song extends SongData {
	addedAt: number;
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

export type Option<T> = T | null;

export const enum CommandOrigin {
	Text,
	Voice,
}

export interface LyricsData {
	lyrics: string;
	copyright: string;
}
