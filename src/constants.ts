import { ButtonStyle, ComponentType } from 'discord.js';
import { Effect, SongProvider } from './typings/common';

export const ALLOWED_PROTOCOLS = new Set(['https:', 'http:']);
export const BAD_TITLE_CHARACTER_REGEX =
	/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]|\([^()]+\)|\[[^[\]]+\]|fe?a?t\. .+/g;

export const PROVIDER_TO_EMOJI: Record<SongProvider, string> = {
	[SongProvider.SoundCloud]: '<:soundcloud:1009952387005431858>',
	[SongProvider.Spotify]: '<:spotify:1009952127512223834>',
	[SongProvider.YouTube]: '<:youtube:1009952565301096448>',
	[SongProvider.Gutenberg]: '<:gutenberg:1014252942230036601>',
};

export const EFFECTS: Record<Effect, string[]> = {
	[Effect.None]: ['-af', 'loudnorm=I=-16:LRA=11:TP=-1.5'],
	[Effect.Loud]: [
		'-filter_complex',
		'acontrast,acrusher=level_in=4:level_out=5:bits=16:mode=log:aa=1',
	],
	[Effect.Underwater]: ['-af', 'lowpass=f=450,volume=2.0'],
	[Effect.Bass]: ['-af', 'bass=g=30,volume=0.7,asubboost'],
	[Effect.Nightcore]: ['-af', 'asetrate=44100*1.25,aresample=44100,atempo=1.25'],
	[Effect.Vaporwave]: ['-af', 'aresample=async=1,atempo=0.8'],
	[Effect.Reverse]: ['-filter_complex', 'areverse'],
	[Effect.EightDimensional]: ['-af', 'apulsator=hz=0.125'],
	[Effect.Denoise]: ['-af', 'asplit[a][b],[a]adelay=32S|32S[a],[b][a]anlms=order=128:leakage=0.0005:mu=.5:out_mode=o'],
	[Effect.Phaser]: ['-af', 'aphaser=in_gain=0.4'],
	[Effect.Tremolo]: ['-af', 'tremolo'],
	[Effect.Vibrato]: ['-af', 'vibrato=f=6.5'],
	[Effect.Normalizer]: ['-af', 'dynaudnorm=f=150:g=15'],
};

export const CUSTOM_ID_TO_INDEX_LIST = {
	toggle: [0, 0],
	previous: [0, 1],
	next: [0, 2],
	remove: [0, 3],
	remove_all: [0, 4],
	repeat: [1, 0],
	shuffle: [1, 1],
	autoplay: [1, 2],
	lyrics: [1, 3],
	effect: [2, 0],
} as const;

export const DEFAULT_COMPONENTS = [
	{
		type: ComponentType.ActionRow,
		components: [
			{
				type: ComponentType.Button,
				customId: 'toggle',
				label: '▶️',
				style: ButtonStyle.Primary,
			},
			{
				type: ComponentType.Button,
				customId: 'previous',
				label: '⏮️',
				style: ButtonStyle.Primary,
			},
			{
				type: ComponentType.Button,
				customId: 'next',
				label: '⏭️',
				style: ButtonStyle.Primary,
			},
			{
				type: ComponentType.Button,
				customId: 'remove',
				label: '🗑️',
				style: ButtonStyle.Secondary,
			},
			{
				type: ComponentType.Button,
				customId: 'remove_all',
				label: '💣',
				style: ButtonStyle.Secondary,
			},
		],
	},
	{
		type: ComponentType.ActionRow,
		components: [
			{
				type: ComponentType.Button,
				customId: 'repeat',
				label: '🔂',
				style: ButtonStyle.Danger
			},
			{
				type: ComponentType.Button,
				customId: 'shuffle',
				label: '🔀',
				style: ButtonStyle.Danger
			},
			{
				type: ComponentType.Button,
				customId: 'autoplay',
				label: '♾️',
				style: ButtonStyle.Danger
			},
			{
				type: ComponentType.Button,
				customId: 'lyrics',
				label: '📜',
				style: ButtonStyle.Danger
			},
		],
	},
	{
		type: ComponentType.ActionRow,
		components: [
			{
				type: ComponentType.StringSelect,
				customId: 'effect',
				placeholder: 'Select an effect...',
				options: [
					{
						label: 'None',
						value: Effect.None.toString(),
					},
					{
						label: 'Loud',
						emoji: '🧨',
						value: Effect.Loud.toString(),
					},
					{
						label: 'Underwater',
						emoji: '🐠',
						value: Effect.Underwater.toString(),
					},
					{
						label: 'Bass',
						emoji: '🎸',
						value: Effect.Bass.toString(),
					},
					{
						label: 'Nightcore',
						emoji: '🌙',
						value: Effect.Nightcore.toString(),
					},
					{
						label: 'Vaporwave',
						emoji: '🌊',
						value: Effect.Vaporwave.toString(),
					},
					{
						label: 'Reverse',
						emoji: '⏪',
						value: Effect.Reverse.toString(),
					},
					{
						label: '8-Dimensional',
						emoji: '🎧',
						value: Effect.EightDimensional.toString(),
					},
					{
						label: 'De-noise',
						emoji: '🔇',
						value: Effect.Denoise.toString(),
					},
					{
						label: 'Phaser',
						emoji: '🎧',
						value: Effect.Phaser.toString(),
					},
					{
						label: 'Tremolo',
						emoji: '🎹',
						value: Effect.Tremolo.toString(),
					},
					{
						label: 'Vibrato',
						emoji: '🎻',
						value: Effect.Vibrato.toString(),
					},
					{
						label: 'Normalizer',
						emoji: '🔊',
						value: Effect.Normalizer.toString(),
					},
				]
			}
		],
	}
];
