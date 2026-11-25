// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import {
  buildScriptDeployment,
  compileScript,
  extractScriptVariables,
  renderScriptText,
  parseScriptDeploymentPath,
  SCRIPT_DEPLOYMENT_PATH_MARKER,
  validateDeployedScriptPath
} from './lazy-script-template'
import { buildInteractiveScriptCommand, findScriptCompletion } from './terminal-script-execution'

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const run = (program: string, cwd?: string) =>
  spawnSync(bash, ['--noprofile', '--norc', '-c', program], { encoding: 'utf8', cwd })
describe.skipIf(process.platform === 'win32' && !existsSync(bash))(
  'literal script parameters and deployment',
  () => {
    const value =
      'pass$$word$& $(printf injected) `printf injected` "quote" \'single\' \\ tail\nsecond line'
    it.each([
      'printf "%s" {{value}}',
      'printf "%s" "{{value}}"',
      "printf '%s' '{{value}}'",
      'X="$(printf "%s" "{{value}}")"; printf "%s" "$X"',
      'X="$(cat <<\'END\'\n{{value}}\nEND\n)"; printf \'%s\' "$X"'
    ])('passes values literally in %s', (template) => {
      const result = run(compileScript(template, { value }, [{ name: 'value' }]))
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toBe(value)
    })
    it('preserves literal quoted heredoc content and avoids delimiter injection', () => {
      const result = run(
        compileScript(
          "cat <<'END'\n$HOME `printf bad` {{value}}\nEND",
          { value: 'END\nprintf bad' },
          [{ name: 'value' }]
        )
      )
      expect(result.stdout).toBe('$HOME `printf bad` END\nprintf bad\n')
      expect(result.status).toBe(0)
    })
    it('does not auto-detect shell variables and uses literal replacement callbacks', () => {
      expect(run(compileScript('cat <<< hello', {}, [])).stdout).toBe('hello\n')
      expect(extractScriptVariables('echo "${HOME}" {{name}}')).toEqual(['name'])
      expect(renderScriptText('{{name}}', { name: '$&$$' }, [{ name: 'name' }])).toBe('$&$$')
      expect(compileScript('printf "%s" "${HOME}"', {}, [])).toContain('${HOME}')
      expect(() => compileScript('{{missing}}', {}, [])).toThrow('请配置')
    })
    it('never compiles or previews a password value or default', () => {
      const vars = [
        { name: 'password', type: 'password', required: true, defaultValue: 'old-secret' }
      ]
      const source = compileScript('PASS="{{password}}"', { password: 'new-secret' }, vars)
      expect(source).not.toContain('new-secret')
      expect(source).not.toContain('old-secret')
      expect(source).toContain('read -r -s')
      expect(source).toContain('${__mshell_value_password}')
      expect(renderScriptText('{{password}}', { password: 'new-secret' }, vars)).toBe(
        '[运行时隐藏输入]'
      )
      expect(run("bash -n <<'CHECK'\n" + source + '\nCHECK').status).toBe(0)
    })
    it('rejects missing required values, duplicate names and invalid filenames', () => {
      expect(() => compileScript('{{name}}', {}, [{ name: 'name', required: true }])).toThrow(
        '请填写'
      )
      expect(() => compileScript('', {}, [{ name: 'name' }, { name: 'name' }])).toThrow('重复')
      expect(() => buildScriptDeployment('true', '../outside.sh')).toThrow('文件名')
    })
    it('atomically deploys valid scripts, and retains the old file on syntax or filesystem errors', () => {
      const root = mkdtempSync(join(tmpdir(), 'mshell-deploy-test-'))
      const destination = join(root, 'scripts').replace(/\\/g, '/')
      const deploy = (content: string) =>
        buildScriptDeployment(content, 'check.sh').split('$HOME/.mshell/scripts').join(destination)
      try {
        let result = run(deploy('printf working'))
        expect(result.status, result.stderr).toBe(0)
        expect(readFileSync(join(destination, 'check.sh'), 'utf8')).toContain('printf working')
        const snapshotCommand = buildScriptDeployment('printf snapshot', 'run.sh', 'saved.sh')
          .split('$HOME/.mshell/scripts')
          .join(destination)
        expect(run(snapshotCommand).status).toBe(0)
        expect(readFileSync(join(destination, 'saved.sh'), 'utf8')).toBe(
          readFileSync(join(destination, 'run.sh'), 'utf8')
        )
        writeFileSync(join(destination, 'saved.sh'), 'printf changed')
        expect(readFileSync(join(destination, 'run.sh'), 'utf8')).toContain('printf snapshot')
        result = run(deploy('if broken'))
        expect(result.status).not.toBe(0)
        expect(result.stdout).not.toContain('已部署')
        expect(readFileSync(join(destination, 'check.sh'), 'utf8')).toContain('printf working')
        const blocker = join(root, 'blocker')
        writeFileSync(blocker, 'file')
        result = run(
          deploy('printf new')
            .split(destination)
            .join(blocker.replace(/\\/g, '/') + '/scripts')
        )
        expect(result.status).not.toBe(0)
        expect(result.stdout).not.toContain('已部署')
        // A destination directory must not silently receive the temporary file.
        rmSync(join(destination, 'check.sh'))
        mkdirSync(join(destination, 'check.sh'))
        expect(run(deploy('printf new')).status).not.toBe(0)
      } finally {
        if (resolve(dirname(root)) === resolve(tmpdir()))
          rmSync(root, { recursive: true, force: true })
      }
    })
    it.each([0, 17])(
      'runs and cleans the uploaded snapshot after switching terminal directories, preserving exit %s',
      (exitCode) => {
        const root = mkdtempSync(join(tmpdir(), 'mshell-script-path-'))
        const loginDirectory = join(root, "john's home", '.mshell', 'scripts')
        const terminalDirectory = join(root, 'root', '.mshell', 'scripts')
        const token = '12345678-1234-1234-1234-123456789abc'
        const fileName = '.run-' + token + '.sh'
        try {
          mkdirSync(terminalDirectory, { recursive: true })
          writeFileSync(join(terminalDirectory, fileName), 'printf WRONG_HOME_SCRIPT')
          const source = `printf '%s\\n' 'UPLOADED_SNAPSHOT'; exit ${exitCode}`
          const deployment = buildScriptDeployment(source, fileName, 'saved.sh', true)
            .split('$HOME/.mshell/scripts')
            .join(loginDirectory.replace(/\\/g, '/'))
          const uploaded = run(deployment)
          expect(uploaded.status, uploaded.stderr).toBe(0)
          const absolutePath = parseScriptDeploymentPath(uploaded.stdout, fileName)
          expect(absolutePath).toContain("john's home/.mshell/scripts/" + fileName)
          const result = run(
            buildInteractiveScriptCommand(absolutePath, token, true),
            terminalDirectory
          )
          expect(result.stdout).toContain('UPLOADED_SNAPSHOT')
          expect(result.stdout).not.toContain('WRONG_HOME_SCRIPT')
          expect(findScriptCompletion(result.stdout, token)).toBe(exitCode)
          expect(existsSync(join(loginDirectory, fileName))).toBe(false)
          expect(readFileSync(join(terminalDirectory, fileName), 'utf8')).toBe(
            'printf WRONG_HOME_SCRIPT'
          )
          expect(readFileSync(join(loginDirectory, 'saved.sh'), 'utf8')).toContain(
            'UPLOADED_SNAPSHOT'
          )
        } finally {
          if (resolve(dirname(root)) === resolve(tmpdir()))
            rmSync(root, { recursive: true, force: true })
        }
      }
    )
  }
)

describe('deployment path protocol', () => {
  it('uses the last server path record without trimming spaces inside the home path', () => {
    const path = "/home/john's home/.mshell/scripts/test.sh"
    expect(
      parseScriptDeploymentPath('banner\n' + SCRIPT_DEPLOYMENT_PATH_MARKER + path + '\n', 'test.sh')
    ).toBe(path)
    expect(buildScriptDeployment('true', 'test.sh')).not.toContain(SCRIPT_DEPLOYMENT_PATH_MARKER)
  })
  it.each([
    '~/.mshell/scripts/test.sh',
    'relative/test.sh',
    '/home/john/../root/test.sh',
    '/home/john/test.sh\nwhoami',
    '/home/john/test.sh\0'
  ])('rejects ambiguous or unsafe paths %s', (path) => {
    expect(() => validateDeployedScriptPath(path, 'test.sh')).toThrow()
  })
  it('requires a matching file and refuses cleanup of a different run', () => {
    expect(() => parseScriptDeploymentPath('success', 'test.sh')).toThrow('未返回')
    expect(() =>
      parseScriptDeploymentPath(SCRIPT_DEPLOYMENT_PATH_MARKER + '/home/john/wrong.sh', 'test.sh')
    ).toThrow('不匹配')
    expect(() =>
      buildInteractiveScriptCommand(
        '/home/john/.mshell/scripts/.run-other.sh',
        '12345678-1234-1234-1234-123456789abc',
        true
      )
    ).toThrow('临时脚本')
  })
})
