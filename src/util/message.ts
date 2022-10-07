import {
	MessageCreateOptions,
	MessagePayload,
	TextBasedChannel,
} from 'discord.js';

export async function sendMessageAndDelete(
	channel: TextBasedChannel,
	options: string | MessagePayload | MessageCreateOptions,
	timeout: number = 3_000
) {
	const message = await channel.send(options);

	return setTimeout(() => {
		message.delete().catch(() => {});
	}, timeout);
}

export function enforceLength(text: string, maxLength: number) {
	return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}
