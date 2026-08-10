/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { bufferToStream, VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { IRequestContext, IRequestOptions } from '../../../../base/parts/request/common/request.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { AuthInfo, Credentials, IRequestService } from '../../../request/common/request.js';
import { ManagedSettingsRequestChannel } from '../../common/managedSettingsRequestIpc.js';

suite('ManagedSettingsRequestChannel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('constructs a fixed request for an allowed endpoint', async () => {
		const requestService = new TestRequestService();
		const channel = new ManagedSettingsRequestChannel(
			requestService,
			() => ['https://api.github.com/copilot_internal/managed_settings'],
			'vscode/1.2.3 copilot-runtime/4.5.6',
		);

		await channel.call(undefined, 'request', [{
			url: 'https://api.github.com/copilot_internal/managed_settings',
			authorization: 'Bearer token',
		}]);

		assert.deepStrictEqual(requestService.lastOptions, {
			type: 'GET',
			url: 'https://api.github.com/copilot_internal/managed_settings',
			disableCache: true,
			followRedirects: 0,
			timeout: 5000,
			headers: {
				Authorization: 'Bearer token',
				'User-Agent': 'vscode/1.2.3 copilot-runtime/4.5.6',
			},
			callSite: 'defaultAccount.managedSettings',
		});
	});

	test('rejects renderer-controlled endpoints and commands', async () => {
		const channel = new ManagedSettingsRequestChannel(
			new TestRequestService(),
			() => ['https://api.github.com/copilot_internal/managed_settings'],
			'vscode/1.2.3',
		);

		await assert.rejects(channel.call(undefined, 'request', [{
			url: 'https://example.com/copilot_internal/managed_settings',
			authorization: 'Bearer token',
		}]), /URL is not allowed/);
		await assert.rejects(channel.call(undefined, 'resolveProxy'), /Invalid managed settings request/);
	});
});

class TestRequestService implements IRequestService {
	readonly _serviceBrand: undefined;
	readonly onDidCompleteRequest = Event.None;
	lastOptions: IRequestOptions | undefined;

	async request(options: IRequestOptions): Promise<IRequestContext> {
		this.lastOptions = options;
		return {
			res: { statusCode: 200, headers: {} },
			stream: bufferToStream(VSBuffer.fromString('{}')),
		};
	}

	async resolveProxy(): Promise<string | undefined> { return undefined; }
	async lookupAuthorization(_authInfo: AuthInfo): Promise<Credentials | undefined> { return undefined; }
	async lookupKerberosAuthorization(): Promise<string | undefined> { return undefined; }
	async loadCertificates(): Promise<string[]> { return []; }
}
