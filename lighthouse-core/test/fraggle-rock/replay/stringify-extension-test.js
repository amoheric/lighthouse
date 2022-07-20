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

describe('LighthouseStringifyExtension', function() {
  // eslint-disable-next-line no-invalid-this
  this.timeout(90_000);

  const state = createTestState();
  state.installServerHooks();

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

  it('crates a valid desktop script', async () => {
    const scriptContents = await stringify(replayFlowJson, {
      extension: new LighthouseStringifyExtension(),
    });

    expect(scriptContents).toMatchSnapshot();
    await fs.writeFile(scriptPath, scriptContents);

    await execFileAsync('node', [scriptPath]);

    const reportHtml = await fs.readFile(`${testTmpDir}/flow.report.html`, 'utf-8');
    const flowResultJson = FLOW_JSON_REGEX.exec(reportHtml)?.[1];
    if (!flowResultJson) throw new Error('Could not find flow json');

    /** @type {LH.FlowResult} */
    const flowResult = JSON.parse(flowResultJson);
    expect(flowResult.steps).toHaveLength(4);
    expect(flowResult.name).toEqual(replayFlowJson.title);

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
