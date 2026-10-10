package expo.modules.vault

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import java.io.Serializable

internal class VaultPickerInput : Serializable

/** the picked folder and the permissions the picker granted for it. */
internal data class PickedFolder(val uri: Uri, val flags: Int)

/** the system folder picker (ACTION_OPEN_DOCUMENT_TREE); null when the user cancels. */
internal class VaultPickerContract : AppContextActivityResultContract<VaultPickerInput, PickedFolder?> {
  override fun createIntent(context: Context, input: VaultPickerInput): Intent {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
      Intent.FLAG_GRANT_READ_URI_PERMISSION or
        Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
    )
    // start in the shared Documents folder, where vaults usually are; the picker falls back to
    // its own default when the folder does not exist.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, DocumentsContract.buildDocumentUri(EXTERNAL_STORAGE, "primary:Documents"))
    }
    return intent
  }

  private companion object {
    const val EXTERNAL_STORAGE = "com.android.externalstorage.documents"
  }

  override fun parseResult(input: VaultPickerInput, resultCode: Int, intent: Intent?): PickedFolder? {
    val uri = intent?.data
    if (resultCode != Activity.RESULT_OK || uri == null) {
      return null
    }
    return PickedFolder(uri, intent.flags)
  }
}
