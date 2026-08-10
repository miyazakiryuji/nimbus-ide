/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { bufferToStream, streamToBuffer, VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IRequestContext } from '../../../base/parts/request/common/request.js';
import { IRequestService } from '../../request/common/request.js';

export const MANAGED_SETTINGS_REQUEST_CHANNEL = 'managedSettingsRequest';
export const MANAGED_SETTINGS_REQUEST_CALL_SITE = 'defaultAccount.managedSettings';

const MANAGED_SETTINGS_REQUEST_TIMEOUT_MS = 5000;

interface IManagedSettingsRequest {
	readonly url: string;
	readonly authorization: string;
}

type ManagedSettingsRequestResponse = [
	{
		headers: IRequestContext['res']['headers'];
		statusCode?: number;
	},
	VSBuffer
];

export function buildManagedSettingsUserAgent(productVersion: string, runtimeVersion: string | undefined): string {
	const product = `vscode/${productVersion}`;
	return runtimeVersion ? `${product} copilot-runtime/${runtimeVersion}` : product;
}

export class ManagedSettingsRequestChannel implements IServerChannel {

	constructor(
		private readonly requestService: IRequestService,
		private readonly getAllowedUrls: () => readonly string[],
		private readonly userAgent: string,
	) { }

	listen<T>(): Event<T> {
		throw new Error('Invalid listen');
	}

	async call<T>(_context: unknown, command: string, args?: unknown, token: CancellationToken = CancellationToken.None): Promise<T> {
		if (command !== 'request' || !Array.isArray(args) || !isManagedSettingsRequest(args[0])) {
			throw new Error(`Invalid managed settings request: ${command}`);
		}

		const request = args[0];
		const url = new URL(request.url);
		const allowed = this.getAllowedUrls().some(candidate => new URL(candidate).href === url.href);
		if (!allowed) {
			throw new Error(`Managed settings URL is not allowed: ${url.origin}${url.pathname}`);
		}

		const { res, stream } = await this.requestService.request({
			type: 'GET',
			url: url.href,
			disableCache: true,
			followRedirects: 0,
			timeout: MANAGED_SETTINGS_REQUEST_TIMEOUT_MS,
			headers: {
				Authorization: request.authorization,
				'User-Agent': this.userAgent,
			},
			callSite: MANAGED_SETTINGS_REQUEST_CALL_SITE,
		}, token);
		return [{ statusCode: res.statusCode, headers: res.headers }, await streamToBuffer(stream)] as T;
	}
}

export class ManagedSettingsRequestChannelClient {

	constructor(private readonly channel: IChannel) { }

	async request(url: string, authorization: string, token: CancellationToken): Promise<IRequestContext> {
		const [res, buffer] = await this.channel.call<ManagedSettingsRequestResponse>('request', [{ url, authorization }], token);
		return { res, stream: bufferToStream(buffer) };
	}
}

function isManagedSettingsRequest(value: unknown): value is IManagedSettingsRequest {
	return typeof value === 'object'
		&& value !== null
		&& typeof Reflect.get(value, 'url') === 'string'
		&& typeof Reflect.get(value, 'authorization') === 'string';
}
