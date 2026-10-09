package expo.modules.vault

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import java.io.Serializable

internal class VaultPickerInput : Serializable

/** the picked folder and the permissions the picker granted for it. */
internal data class PickedFolder(val uri: Uri, val flags: Int)

/** the system folder picker (ACTION_OPEN_DOCUMENT_TREE); null when the user cancels. */
internal class VaultPickerContract : AppContextActivityResultContract<VaultPickerInput, PickedFolder?> {
  override fun createIntent(context: Context, input: VaultPickerInput): Intent =
    Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
      Intent.FLAG_GRANT_READ_URI_PERMISSION or
        Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
    )

  override fun parseResult(input: VaultPickerInput, resultCode: Int, intent: Intent?): PickedFolder? {
    val uri = intent?.data
    if (resultCode != Activity.RESULT_OK || uri == null) {
      return null
    }
    return PickedFolder(uri, intent.flags)
  }
}
