import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Effect, SongProvider } from './typings';

export const ALLOWED_PROTOCOLS = new Set(['https:', 'http:']);
export const BAD_TITLE_CHARACTER_REGEX =
	/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]|\([^()]+\)|\[[^\[\]]+\]|fe?a?t\. .+/g;

export const PROVIDER_TO_EMOJI: Record<SongProvider, string> = {
	[SongProvider.SoundCloud]: '<:soundcloud:1009952387005431858>',
	[SongProvider.Spotify]: '<:spotify:1009952127512223834>',
	[SongProvider.YouTube]: '<:youtube:1009952565301096448>',
	[SongProvider.Gutenberg]: '<:gutenberg:1014228032820621453>',
};

export const EFFECTS: Record<Effect, string[]> = {
	[Effect.None]: ['-af', 'loudnorm=I=-16:LRA=11:TP=-1.5'],
	[Effect.Loud]: [
		'-filter_complex',
		'acontrast, acrusher=level_in=4:level_out=5:bits=16:mode=log:aa=1',
	],
	[Effect.UnderWater]: ['-af', 'lowpass=f=450, volume=2.0'],
	[Effect.Bass]: ['-af', 'bass=g=30, volume=0.7, asubboost'],
	[Effect.Echo]: [
		'-af',
		'aecho=1.0:1.0:1000|1400:1.0|0.25, aphaser=0.4:0.4:2.0:0.6:0.5:s, asubboost, volume=4.0',
	],
	[Effect.HighPitch]: ['-af', 'atempo=2/4, asetrate=44100*4/2'],
	[Effect.Reverse]: ['-filter_complex', 'areverse'],
};

export const EFFECT_TO_INDEX_LIST = {
	[Effect.None]: [-1, -1],
	[Effect.Loud]: [3, 0],
	[Effect.UnderWater]: [3, 1],
	[Effect.Bass]: [3, 2],
	[Effect.Echo]: [3, 3],
	[Effect.HighPitch]: [3, 4],
	[Effect.Reverse]: [4, 0],
} as const;

export const CUSTOM_ID_TO_INDEX_LIST = {
	toggle: [0, 0],
	previous: [0, 1],
	next: [0, 2],
	repeat: [0, 3],
	shuffle: [0, 4],
	remove: [1, 0],
	remove_all: [1, 1],
	star: [1, 2],
	play_starred: [1, 3],
	autoplay: [2, 0],
	lyrics: [2, 1],
} as const;

export const DEFAULT_COMPONENTS = [
	new ActionRowBuilder<ButtonBuilder>({
		components: [
			new ButtonBuilder({
				customId: 'toggle',
				label: '▶️',
				style: ButtonStyle.Primary,
			}),
			new ButtonBuilder({
				customId: 'previous',
				label: '⏮️',
				style: ButtonStyle.Primary,
			}),
			new ButtonBuilder({
				customId: 'next',
				label: '⏭️',
				style: ButtonStyle.Primary,
			}),
			new ButtonBuilder({
				customId: 'repeat',
				label: '🔂',
				style: ButtonStyle.Danger,
			}),
			new ButtonBuilder({
				customId: 'shuffle',
				label: '🔀',
				style: ButtonStyle.Primary,
			}),
		],
	}),
	new ActionRowBuilder<ButtonBuilder>({
		components: [
			new ButtonBuilder({
				customId: 'remove',
				label: '🗑️',
				style: ButtonStyle.Primary,
			}),
			new ButtonBuilder({
				customId: 'remove_all',
				label: '💣',
				style: ButtonStyle.Primary,
			}),
			new ButtonBuilder({
				customId: 'star',
				label: '⭐️',
				style: ButtonStyle.Danger,
			}),
			new ButtonBuilder({
				customId: 'play_starred',
				label: '☀️',
				style: ButtonStyle.Primary,
			}),
		],
	}),
	new ActionRowBuilder<ButtonBuilder>({
		components: [
			new ButtonBuilder({
				customId: 'autoplay',
				label: '♾️',
				style: ButtonStyle.Danger,
			}),
			new ButtonBuilder({
				customId: 'lyrics',
				label: '📜',
				style: ButtonStyle.Danger,
			}),
		],
	}),
	new ActionRowBuilder<ButtonBuilder>({
		components: [
			new ButtonBuilder({
				customId: 'loud',
				label: '🧨',
				style: ButtonStyle.Danger,
			}),
			new ButtonBuilder({
				customId: 'underwater',
				label: '🌊',
				style: ButtonStyle.Danger,
			}),
			new ButtonBuilder({
				customId: 'bass',
				label: '🥁',
				style: ButtonStyle.Danger,
			}),
			new ButtonBuilder({
				customId: 'echo',
				label: '🧯',
				style: ButtonStyle.Danger,
			}),
			new ButtonBuilder({
				customId: 'high_pitch',
				label: '🐿️',
				style: ButtonStyle.Danger,
			}),
		],
	}),
	new ActionRowBuilder<ButtonBuilder>({
		components: [
			new ButtonBuilder({
				customId: 'reverse',
				label: '⏪',
				style: ButtonStyle.Danger,
			}),
		],
	}),
];
