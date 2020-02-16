import * as assert from 'assert'
import * as core from '@actions/core'
import * as fs from 'fs'
import * as io from '@actions/io'
import * as os from 'os'
import * as path from 'path'
import * as stateHelper from './state-helper'
import {default as uuid} from 'uuid/v4'
import {IGitCommandManager} from './git-command-manager'
import {IGitSourceSettings} from './git-source-settings'
import { exec } from '@actions/exec'

const hostname = 'github.com'
const extraHeaderKey = `http.https://${hostname}/.extraheader`
const sshCommandKey = 'core.sshCommand'

export interface IGitAuthHelper {
  configureAuth(): Promise<void>
  removeAuth(): Promise<void>
}

export function createAuthHelper(
  git: IGitCommandManager,
  settings?: IGitSourceSettings
): IGitAuthHelper {
  return new GitAuthHelper(git, settings)
}

class GitAuthHelper {
  private git: IGitCommandManager
  private settings: IGitSourceSettings
  private sshKeyPath = ''
  private sshKnownHostsPath = ''

  constructor(
    gitCommandManager: IGitCommandManager,
    gitSourceSettings?: IGitSourceSettings
  ) {
    this.git = gitCommandManager
    this.settings = gitSourceSettings || (({} as unknown) as IGitSourceSettings)
  }

  async configureAuth(): Promise<void> {
    // Remove possible previous values
    await this.removeSsh()
    await this.removeToken()

    // Configure new values
    await this.configureSsh()
    await this.configureToken()
  }

  async removeAuth(): Promise<void> {
    await this.removeSsh()
    await this.removeToken()
  }

  private async configureSsh(): Promise<void> {
    if (!this.settings.sshKey) {
      return
    }

    // Write key
    const runnerTemp = process.env['RUNNER_TEMP'] || ''
    assert.ok(runnerTemp, 'RUNNER_TEMP is not defined')
    const uniqueId = uuid()
    this.sshKeyPath = path.join(runnerTemp, uniqueId)
    stateHelper.setSshKeyPath(this.sshKeyPath)
    await fs.promises.mkdir(runnerTemp, {recursive: true})
    await fs.promises.writeFile(this.sshKeyPath, this.settings.sshKey + '\n', { mode: 0o600 })
    // await fs.promises.chmod(this.sshKeyPath, 0o600)
    await exec(`ls -la ${this.sshKeyPath}`)
    await exec(`cat ${this.sshKeyPath}`)

    // Write known hosts
    const userKnownHostsPath = path.join(os.homedir(), '.ssh', 'known_hosts')
    let userKnownHosts = ''
    try {
      userKnownHosts = (
        await fs.promises.readFile(userKnownHostsPath)
      ).toString()
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err
      }
    }
    let knownHosts = ''
    if (userKnownHosts) {
      // knownHosts = `# Begin from ${userKnownHostsPath}\n${userKnownHosts}\n# End from ${userKnownHostsPath}\n`
    }
    knownHosts +=
      'github.com ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAQEAq2A7hRGmdnm9tUDbO9IDSwBK6TbQa+PXYPCPy6rbTrTtw7PHkccKrpp0yVhp5HdEIcKr6pLlVDBfOLX9QUsyCOV0wzfjIJNlGEYsdlLJizHhbn2mUjvSAHQqZETYP81eFzLQNnPHt4EVVUh7VfDESU84KezmD5QlWpXLmvU31/yMf+Se8xhHTvKSCZIFImWwoG6mbUoWf9nzpIoaSjB+weqqUUmpaaasXVal72J+UX2B+2RPW3RcT0eOzQgqlJL3RKrTJvdsjE3JEAvGq3lGHSZXy28G3skua2SmVi/w4yCE6gbODqnTWlg7+wC604ydGXA8VJiS5ap43JXiUFFAaQ==\n'
    this.sshKnownHostsPath = path.join(runnerTemp, `${uniqueId}_known_hosts`)
    stateHelper.setSshKnownHostsPath(this.sshKnownHostsPath)
    await fs.promises.writeFile(this.sshKnownHostsPath, knownHosts)

    // Configure GIT_SSH_COMMAND
    const sshPath = await io.which('ssh', true)
    let sshCommand = `"${sshPath}" -i ${this.sshKeyPath}`
    if (this.settings.sshStrict) {
      sshCommand += ' -o StrictHostKeyChecking=yes -o CheckHostIP=no'
    }
    sshCommand += ` -o UserKnownHostsFile=${this.sshKnownHostsPath}`
    this.git.setEnvironmentVariable('GIT_SSH_COMMAND', sshCommand)

    // Configure core.sshCommand
    if (this.settings.persistCredentials) {
      await this.git.config(sshCommandKey, sshCommand)
    }
  }

  private async configureToken(): Promise<void> {
    // Skip when using SSH and not persisting credentials
    if (this.settings.sshKey && !this.settings.persistCredentials) {
      return
    }

    // Configure a placeholder value. This approach avoids the credential being captured
    // by process creation audit events, which are commonly logged. For more information,
    // refer to https://docs.microsoft.com/en-us/windows-server/identity/ad-ds/manage/component-updates/command-line-process-auditing
    const placeholder = `AUTHORIZATION: basic ***`
    await this.git.config(extraHeaderKey, placeholder)

    // Determine the basic credential value
    const basicCredential = Buffer.from(
      `x-access-token:${this.settings.authToken}`,
      'utf8'
    ).toString('base64')
    core.setSecret(basicCredential)

    // Replace the value in the config file
    const configPath = path.join(
      this.git.getWorkingDirectory(),
      '.git',
      'config'
    )
    let content = (await fs.promises.readFile(configPath)).toString()
    const placeholderIndex = content.indexOf(placeholder)
    if (
      placeholderIndex < 0 ||
      placeholderIndex != content.lastIndexOf(placeholder)
    ) {
      throw new Error('Unable to replace auth placeholder in .git/config')
    }
    content = content.replace(
      placeholder,
      `AUTHORIZATION: basic ${basicCredential}`
    )
    await fs.promises.writeFile(configPath, content)
  }

  private async removeSsh(): Promise<void> {
    // SSH key
    const keyPath = this.sshKeyPath || stateHelper.SshKeyPath
    if (keyPath) {
      try {
        await io.rmRF(keyPath)
      } catch (err) {
        core.warning(`Failed to remove SSH key '${keyPath}'`)
      }
    }

    // SSH known hosts
    const knownHostsPath =
      this.sshKnownHostsPath || stateHelper.SshKnownHostsPath
    if (knownHostsPath) {
      try {
        await io.rmRF(knownHostsPath)
      } catch {
        // Intentionally empty
      }
    }

    // SSH command
    await this.removeGitConfig(sshCommandKey)
  }

  private async removeToken(): Promise<void> {
    // HTTP extra header
    await this.removeGitConfig(extraHeaderKey)
  }

  private async removeGitConfig(configKey: string): Promise<void> {
    if (
      (await this.git.configExists(configKey)) &&
      !(await this.git.tryConfigUnset(configKey))
    ) {
      // Load the config contents
      core.warning(`Failed to remove '${configKey}' from the git config`)
    }
  }
}
