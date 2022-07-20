/**
 * @license Copyright 2022 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import {promises as fs} from 'fs';
import {promisify} from 'util';
import {execFile} from 'child_process';

import {stringify} from '@puppeteer/replay';

import {LH_ROOT} from '../../../../root.js';
import LighthouseStringifyExtension from '../../../fraggle-rock/replay/stringify-extension.js';
import {getAuditsBreakdown, createTestState} from '../scenarios/pptr-test-utils.js';
import {readJson} from '../../test-utils.js';

const execFileAsync = promisify(execFile);
const replayFlowJson = readJson(`${LH_ROOT}/lighthouse-core/test/fixtures/fraggle-rock/replay/test-flow.json`);
const FLOW_JSON_REGEX = /window\.__LIGHTHOUSE_FLOW_JSON__ = (.*);<\/script>/;

describe('LighthouseStringifyExtension', () => {
  it('handles ending timespan', async () => {
    /** @type {import('@puppeteer/replay').Schema.UserFlow} */
    const flowJson = {
      title: 'Test Flow',
      steps: [
        {
          type: 'setViewport',
          width: 757,
          height: 988,
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
          isLandscape: false,
        },
        {
          type: 'navigate',
          url: 'https://example.com',
          assertedEvents: [
            {
              type: 'navigation',
              url: 'https://example.com',
              title: '',
            },
          ],
        },
        {
          type: 'click',
          target: 'main',
          selectors: [['#button']],
          offsetY: 13.5625,
          offsetX: 61,
        },
      ],
    };

    const scriptContents = await stringify(flowJson, {
      extension: new LighthouseStringifyExtension(),
    });

    // Trim the output to the relevant stuff
    const endIndex = scriptContents.indexOf('browser.close');
    const relevantOutput = scriptContents.substring(0, endIndex);

    expect(relevantOutput).toMatchSnapshot();
  });

  it('handles ending navigation', async () => {
    /** @type {import('@puppeteer/replay').Schema.UserFlow} */
    const flowJson = {
      title: 'Test Flow',
      steps: [
        {
          type: 'setViewport',
          width: 757,
          height: 988,
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
          isLandscape: false,
        },
        {
          type: 'navigate',
          url: 'https://example.com',
          assertedEvents: [
            {
              type: 'navigation',
              url: 'https://example.com',
              title: '',
            },
          ],
        },
        {
          type: 'click',
          target: 'main',
          selectors: [['#button']],
          offsetY: 13.5625,
          offsetX: 61,
        },
        {
          type: 'navigate',
          url: 'https://example.com/page/',
          assertedEvents: [
            {
              type: 'navigation',
              url: 'https://example.com/page/',
              title: '',
            },
          ],
        },
      ],
    };

    const scriptContents = await stringify(flowJson, {
      extension: new LighthouseStringifyExtension(),
    });

    // Trim the output to the relevant stuff
    const endIndex = scriptContents.indexOf('browser.close');
    const relevantOutput = scriptContents.substring(0, endIndex);

    expect(relevantOutput).toMatchSnapshot();
  });

  it('handles multiple sequential navigations', async () => {
    /** @type {import('@puppeteer/replay').Schema.UserFlow} */
    const flowJson = {
      title: 'Test Flow',
      steps: [
        {
          type: 'setViewport',
          width: 757,
          height: 988,
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
          isLandscape: false,
        },
        {
          type: 'navigate',
          url: 'https://example.com',
          assertedEvents: [
            {
              type: 'navigation',
              url: 'https://example.com',
              title: '',
            },
          ],
        },
        {
          type: 'click',
          target: 'main',
          selectors: [['#link']],
          offsetY: 13.5625,
          offsetX: 61,
          assertedEvents: [
            {
              type: 'navigation',
              url: 'https://example.com/page',
              title: '',
            },
          ],
        },
      ],
    };

    const scriptContents = await stringify(flowJson, {
      extension: new LighthouseStringifyExtension(),
    });

    // Trim the output to the relevant stuff
    const endIndex = scriptContents.indexOf('browser.close');
    const relevantOutput = scriptContents.substring(0, endIndex);

    expect(relevantOutput).toMatchSnapshot();
  });

  describe('running the output script', function() {
    // eslint-disable-next-line no-invalid-this
    this.timeout(60_000);

    // Flow JSON specifies port 10200 so we have to use that for the server.
    const state = createTestState();
    state.installServerHooks(10200);

    const tmpDir = `${LH_ROOT}/.tmp/replay`;
    let testTmpDir = '';
    let scriptPath = '';

    before(async () => {
      await fs.mkdir(tmpDir, {recursive: true});
      // Stringified exports are CJS
      fs.writeFile(`${tmpDir}/package.json`, '{"type": "commonjs"}');
    });

    beforeEach(async () => {
      testTmpDir = await fs.mkdtemp(`${tmpDir}/replay-`);
      scriptPath = `${testTmpDir}/stringified.js`;
    });

    after(async () => {
      await fs.rm(tmpDir, {recursive: true, force: true});
    });

    it('crates a valid desktop report', async () => {
      const scriptContents = await stringify(replayFlowJson, {
        extension: new LighthouseStringifyExtension(),
      });

      expect(scriptContents).toMatchSnapshot();
      await fs.writeFile(scriptPath, scriptContents);

      const {stdout, stderr} = await execFileAsync('node', [scriptPath], {timeout: 50_000});

      // Ensure script didn't quietly report an issue.
      expect(stdout).toEqual('');
      expect(stderr).toEqual('');

      const reportHtml = await fs.readFile(`${testTmpDir}/flow.report.html`, 'utf-8');
      const flowResultJson = FLOW_JSON_REGEX.exec(reportHtml)?.[1];
      if (!flowResultJson) throw new Error('Could not find flow json');

      /** @type {LH.FlowResult} */
      const flowResult = JSON.parse(flowResultJson);
      expect(flowResult.name).toEqual(replayFlowJson.title);
      expect(flowResult.steps.map(step => step.lhr.gatherMode)).toEqual([
        'navigation',
        'timespan',
        'navigation',
        'timespan',
      ]);

      for (const {lhr} of flowResult.steps) {
        expect(lhr.configSettings.formFactor).toEqual('desktop');
        expect(lhr.configSettings.screenEmulation.disabled).toBeTruthy();

        const {auditResults, erroredAudits} = getAuditsBreakdown(lhr);
        expect(auditResults.length).toBeGreaterThanOrEqual(10);

        // TODO: INP breakdown diagnostic audit is broken because of old Chrome
        expect(erroredAudits.length).toBeLessThanOrEqual(1);
      }
    });
  });
});
