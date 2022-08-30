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
	Gutenberg,
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

export type Language =
	| 'en'
	| 'af-ZA'
	| 'am-ET'
	| 'hy-AM'
	| 'az-AZ'
	| 'id-ID'
	| 'ms-MY'
	| 'bn-BD'
	| 'bn-IN'
	| 'ca-ES'
	| 'cs-CZ'
	| 'da-DK'
	| 'de-DE'
	| 'en-AU'
	| 'en-CA'
	| 'en-GH'
	| 'en-GB'
	| 'en-IN'
	| 'en-IE'
	| 'en-KE'
	| 'en-NZ'
	| 'en-NG'
	| 'en-PH'
	| 'en-SG'
	| 'en-ZA'
	| 'en-TZ'
	| 'en-US'
	| 'es-AR'
	| 'es-BO'
	| 'es-CL'
	| 'es-CO'
	| 'es-CR'
	| 'es-EC'
	| 'es-SV'
	| 'es-ES'
	| 'es-US'
	| 'es-GT'
	| 'es-HN'
	| 'es-MX'
	| 'es-NI'
	| 'es-PA'
	| 'es-PY'
	| 'es-PE'
	| 'es-PR'
	| 'es-DO'
	| 'es-UY'
	| 'es-VE'
	| 'eu-ES'
	| 'fil-PH'
	| 'fr-CA'
	| 'fr-FR'
	| 'gl-ES'
	| 'ka-GE'
	| 'gu-IN'
	| 'hr-HR'
	| 'zu-ZA'
	| 'is-IS'
	| 'it-IT'
	| 'jv-ID'
	| 'kn-IN'
	| 'km-KH'
	| 'lo-LA'
	| 'lv-LV'
	| 'lt-LT'
	| 'hu-HU'
	| 'ml-IN'
	| 'mr-IN'
	| 'nl-NL'
	| 'ne-NP'
	| 'nb-NO'
	| 'pl-PL'
	| 'pt-BR'
	| 'pt-PT'
	| 'ro-RO'
	| 'si-LK'
	| 'sk-SK'
	| 'sl-SI'
	| 'su-ID'
	| 'sw-TZ'
	| 'sw-KE'
	| 'fi-FI'
	| 'sv-SE'
	| 'ta-IN'
	| 'ta-SG'
	| 'ta-LK'
	| 'ta-MY'
	| 'te-IN'
	| 'vi-VN'
	| 'tr-TR'
	| 'ur-PK'
	| 'ur-IN'
	| 'el-GR'
	| 'bg-BG'
	| 'ru-RU'
	| 'sr-RS'
	| 'uk-UA'
	| 'he-IL'
	| 'ar-IL'
	| 'ar-JO'
	| 'ar-AE'
	| 'ar-BH'
	| 'ar-DZ'
	| 'ar-SA'
	| 'ar-IQ'
	| 'ar-KW'
	| 'ar-MA'
	| 'ar-TN'
	| 'ar-OM'
	| 'ar-PS'
	| 'ar-QA'
	| 'ar-LB'
	| 'ar-EG'
	| 'fa-IR'
	| 'hi-IN'
	| 'th-TH'
	| 'ko-KR'
	| 'zh-TW'
	| 'yue-Hant-HK'
	| 'ja-JP'
	| 'zh-HK'
	| 'zh';
