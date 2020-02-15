import * as assert from 'assert'
import * as core from '@actions/core'
import * as fs from 'fs'
import * as fsHelper from './fs-helper'
import * as gitCommandManager from './git-command-manager'
import * as io from '@actions/io'
import * as path from 'path'
import * as stateHelper from './state-helper'
import {default as uuid} from 'uuid/v4'
import {IGitCommandManager} from './git-command-manager'
import { IGitSourceSettings } from './git-source-settings'
import { settings } from 'cluster'

const hostname = 'github.com'
const extraHeaderKey = `http.https://${hostname}/.extraheader`
const sshCommandKey = 'core.sshCommand'

export interface IGitAuthHelper {
  configureAuth(git: IGitCommandManager, settings: IGitSourceSettings): Promise<void>
  removeAuth(git: IGitCommandManager): Promise<void>
}

export function CreateAuthHelper(
  git: IGitCommandManager,
  settings: IGitSourceSettings
): IGitAuthHelper {
  return GitAuthHelper.createAuthHelper(git, settings)
}

class GitAuthHelper {
  private git: IGitCommandManager
  private settings: IGitSourceSettings
  private sshKeyPath = ''
  private sshKnownHostsPath = ''

  // Private constructor; use createAuthHelper()
  private constructor(g: IGitCommandManager, s: IGitSourceSettings | undefined) {
    this.git = g
    this.settings = s || ({} as unknown) as IGitSourceSettings
  }

  async configureAuth(git: IGitCommandManager, settings: IGitSourceSettings): Promise<void> {
    await this.configureToken()
    await this.configureSsh()
  }

// export async function configureAuth(git: IGitCommandManager): Promise<void> {
//     try {
//       // Config http extra header
//       await configureAuthToken(git, settings.authToken)

//       // Configure ssh auth
//       await configureSsh(git, settings)

//       // LFS install
//       if (settings.lfs) {
//         await git.lfsInstall()
//       }

//       // Fetch
//       const refSpec = refHelper.getRefSpec(settings.ref, settings.commit)
//       await git.fetch(settings.fetchDepth, refSpec)

//       // Checkout info
//       const checkoutInfo = await refHelper.getCheckoutInfo(
//         git,
//         settings.ref,
//         settings.commit
//       )

//       // LFS fetch
//       // Explicit lfs-fetch to avoid slow checkout (fetches one lfs object at a time).
//       // Explicit lfs fetch will fetch lfs objects in parallel.
//       if (settings.lfs) {
//         await git.lfsFetch(checkoutInfo.startPoint || checkoutInfo.ref)
//       }

//       // Checkout
//       await git.checkout(checkoutInfo.ref, checkoutInfo.startPoint)

//       // Dump some info about the checked out commit
//       await git.log1()
//     } finally {
//       if (!settings.persistCredentials) {
//         await removeGitConfig(git, extraHeaderKey)
//       }
//     }
//   }
// }

  async removeAuth(git: IGitCommandManager): Promise<void>{
    await this.removeSsh()
    await this.removeToken()
  }

  static createAuthHelper(
    git: IGitCommandManager,
    settings: IGitSourceSettings | undefined
  ): IGitAuthHelper {
    return new GitAuthHelper(git, settings)
  }

  private async configureSsh(
  ):Promise<void> {
    if (!this.settings.sshKey) {
      return
    }

    // Write key
    const runnerTemp = process.env['RUNNER_TEMP'] || ''
    assert.ok(runnerTemp, 'RUNNER_TEMP is not defined')
    const uniqueId = uuid()
    this.sshKeyPath = path.join(runnerTemp, uniqueId)
    stateHelper.setSshKeyPath(this.sshKeyPath)
    await fs.promises.writeFile()
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
    const configPath = path.join(this.git.getWorkingDirectory(), '.git', 'config')
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
      }
      catch (err) {
        core.warning(`Failed to remove SSH key '${keyPath}'`)
      }
    }
  
    // SSH known hosts
    const knownHostsPath = this.sshKnownHostsPath || stateHelper.SshKnownHostsPath
    if (knownHostsPath) {
      try {
        await io.rmRF(knownHostsPath)
      }
      catch {
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

  private async removeGitConfig(
    configKey: string
  ): Promise<void> {
    if (
      (await this.git.configExists(configKey)) &&
      !(await this.git.tryConfigUnset(configKey))
    ) {
      // Load the config contents
      core.warning(`Failed to remove '${configKey}' from the git config`)
    }
  }
}

// export async function configureAuth(git: IGitCommandManager): Promise<void> {
//     try {
//       // Config http extra header
//       await configureAuthToken(git, settings.authToken)

//       // Configure ssh auth
//       await configureSsh(git, settings)

//       // LFS install
//       if (settings.lfs) {
//         await git.lfsInstall()
//       }

//       // Fetch
//       const refSpec = refHelper.getRefSpec(settings.ref, settings.commit)
//       await git.fetch(settings.fetchDepth, refSpec)

//       // Checkout info
//       const checkoutInfo = await refHelper.getCheckoutInfo(
//         git,
//         settings.ref,
//         settings.commit
//       )

//       // LFS fetch
//       // Explicit lfs-fetch to avoid slow checkout (fetches one lfs object at a time).
//       // Explicit lfs fetch will fetch lfs objects in parallel.
//       if (settings.lfs) {
//         await git.lfsFetch(checkoutInfo.startPoint || checkoutInfo.ref)
//       }

//       // Checkout
//       await git.checkout(checkoutInfo.ref, checkoutInfo.startPoint)

//       // Dump some info about the checked out commit
//       await git.log1()
//     } finally {
//       if (!settings.persistCredentials) {
//         await removeGitConfig(git, extraHeaderKey)
//       }
//     }
//   }
// }

// export async function cleanup(repositoryPath: string): Promise<void> {
//   // Repo exists?
//   if (
//     !repositoryPath ||
//     !fsHelper.fileExistsSync(path.join(repositoryPath, '.git', 'config'))
//   ) {
//     return
//   }

//   let git: IGitCommandManager
//   try {
//     git = await gitCommandManager.CreateCommandManager(repositoryPath, false)
//   } catch {
//     return
//   }

//   // Remove extraheader
//   await removeGitConfig(git, extraHeaderKey)
// }

// async function configureAuthToken(
//   git: IGitCommandManager,
//   authToken: string
// ): Promise<void> {
//   // Configure a placeholder value. This approach avoids the credential being captured
//   // by process creation audit events, which are commonly logged. For more information,
//   // refer to https://docs.microsoft.com/en-us/windows-server/identity/ad-ds/manage/component-updates/command-line-process-auditing
//   const placeholder = `AUTHORIZATION: basic ***`
//   await git.config(extraHeaderKey, placeholder)

//   // Determine the basic credential value
//   const basicCredential = Buffer.from(
//     `x-access-token:${authToken}`,
//     'utf8'
//   ).toString('base64')
//   core.setSecret(basicCredential)

//   // Replace the value in the config file
//   const configPath = path.join(git.getWorkingDirectory(), '.git', 'config')
//   let content = (await fs.promises.readFile(configPath)).toString()
//   const placeholderIndex = content.indexOf(placeholder)
//   if (
//     placeholderIndex < 0 ||
//     placeholderIndex != content.lastIndexOf(placeholder)
//   ) {
//     throw new Error('Unable to replace auth placeholder in .git/config')
//   }
//   content = content.replace(
//     placeholder,
//     `AUTHORIZATION: basic ${basicCredential}`
//   )
//   await fs.promises.writeFile(configPath, content)
// }

// async function configureSsh(
//   git: IGitCommandManager,
//   settings: ISourceSettings
// ): promise<void> {
//   if (!settings.sshKey) {
//     return
//   }

//   const runnerTemp = process.env['RUNNER_TEMP'] || ''
//   assert.ok(runnerTemp, 'RUNNER_TEMP is not defined')
//   const uniqueId = uuid()
//   const keyPath = path.join(runnerTemp, uniqueId)
//   const
// }

// async function removeGitConfig(
//   git: IGitCommandManager,
//   configKey: string
// ): Promise<void> {
//   if (
//     (await git.configExists(configKey)) &&
//     !(await git.tryConfigUnset(configKey))
//   ) {
//     // Load the config contents
//     core.warning(`Failed to remove '${configKey}' from the git config`)
//   }
// }
