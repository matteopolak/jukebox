import { MessageOptions, MessagePayload, TextBasedChannel } from 'discord.js';

export async function sendMessageAndDelete(
	channel: TextBasedChannel,
	options: string | MessagePayload | MessageOptions,
	timeout: number = 3_000
) {
	const message = await channel.send(options);

	return setTimeout(() => {
		message.delete().catch(() => {});
	}, timeout);
}
