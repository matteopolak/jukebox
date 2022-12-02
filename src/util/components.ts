import { ActionRowData, ButtonComponentData, ButtonStyle, ComponentType, StringSelectMenuComponentData } from 'discord.js';
import { ConnectionSettings, Effect } from '@/typings/common';

export function getDefaultComponents(settings: ConnectionSettings) {
	const components: [ActionRowData<ButtonComponentData>, ActionRowData<ButtonComponentData>, ActionRowData<StringSelectMenuComponentData>] = [
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
					style: ButtonStyle.Danger,
				},
				{
					type: ComponentType.Button,
					customId: 'remove_all',
					label: '💣',
					style: ButtonStyle.Danger,
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
					style: settings.repeat
						? ButtonStyle.Success
						: ButtonStyle.Secondary,
				},
				{
					type: ComponentType.Button,
					customId: 'shuffle',
					label: '🔀',
					style: settings.shuffle
						? ButtonStyle.Success
						: ButtonStyle.Secondary,
				},
				{
					type: ComponentType.Button,
					customId: 'autoplay',
					label: '♾️',
					style: settings.autoplay
						? ButtonStyle.Success
						: ButtonStyle.Secondary,
				},
				{
					type: ComponentType.Button,
					customId: 'lyrics',
					label: '📜',
					style: settings.lyrics
						? ButtonStyle.Success
						: ButtonStyle.Secondary,
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
							default: settings.effect === Effect.None,
						},
						{
							label: 'Bass',
							emoji: '🎸',
							value: Effect.Bass.toString(),
							default: settings.effect === Effect.Bass,
						},
						{
							label: 'Daycore',
							emoji: '🌞',
							value: Effect.Daycore.toString(),
							default: settings.effect === Effect.Daycore,
						},
						{
							label: 'De-noise',
							emoji: '🔇',
							value: Effect.Denoise.toString(),
							default: settings.effect === Effect.Denoise,
						},
						{
							label: '8-Dimensional',
							emoji: '🛰️',
							value: Effect.EightDimensional.toString(),
							default: settings.effect === Effect.EightDimensional,
						},
						{
							label: 'Loud',
							emoji: '🧨',
							value: Effect.Loud.toString(),
							default: settings.effect === Effect.Loud,
						},
						{
							label: 'Nightcore-',
							emoji: '🌓',
							value: Effect.NightcoreMinus.toString(),
							default: settings.effect === Effect.NightcoreMinus,
						},
						{
							label: 'Nightcore',
							emoji: '🌑',
							value: Effect.Nightcore.toString(),
							default: settings.effect === Effect.Nightcore,
						},
						{
							label: 'Nightcore+',
							emoji: '🪩',
							value: Effect.NightcorePlus.toString(),
							default: settings.effect === Effect.NightcorePlus,
						},
						{
							label: 'Normalizer',
							emoji: '🔊',
							value: Effect.Normalizer.toString(),
							default: settings.effect === Effect.Normalizer,
						},
						{
							label: 'Phaser',
							emoji: '🎧',
							value: Effect.Phaser.toString(),
							default: settings.effect === Effect.Phaser,
						},
						{
							label: 'Reverse',
							emoji: '⏪',
							value: Effect.Reverse.toString(),
							default: settings.effect === Effect.Reverse,
						},
						{
							label: 'Tremolo',
							emoji: '🎹',
							value: Effect.Tremolo.toString(),
							default: settings.effect === Effect.Tremolo,
						},
						{
							label: 'Underwater',
							emoji: '🐠',
							value: Effect.Underwater.toString(),
							default: settings.effect === Effect.Underwater,
						},
						
						{
							label: 'Vaporwave',
							emoji: '🌊',
							value: Effect.Vaporwave.toString(),
							default: settings.effect === Effect.Vaporwave,
						},
						{
							label: 'Vibrato',
							emoji: '🎻',
							value: Effect.Vibrato.toString(),
							default: settings.effect === Effect.Vibrato,
						},
					],
				},
			],
		},
	];

	return components;
}