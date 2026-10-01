package net.solardepin.solarchik

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import net.solardepin.solarchik.game.GameSave
import net.solardepin.solarchik.notify.NoteKind
import net.solardepin.solarchik.notify.Notes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.ZoneOffset

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NotesTest {
    private lateinit var ctx: Context
    private val now = LocalDate.of(2026, 10, 1).atTime(22, 0).toInstant(ZoneOffset.UTC).toEpochMilli()

    @Before fun setUp() {
        ctx = ApplicationProvider.getApplicationContext()
        listOf("solarchik-game", "solarchik-notes", "solarchik-desk").forEach { ctx.getSharedPreferences(it, Context.MODE_PRIVATE).edit().clear().commit() }
        ctx.getSharedPreferences("solarchik-game", Context.MODE_PRIVATE).edit()
            .putInt("streak", 4).putString("signedDay", "2026-09-30").putInt("seven", 4).putInt("thirty", 4).commit()
        Notes.createChannel(ctx)
    }

    @Test fun postsStreakNoteOnceWhenAllowed() {
        shadowOf(ctx as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val save = GameSave(ctx) { now }
        val posted = Notes.check(ctx, save)
        assertEquals(listOf(NoteKind.STREAK), posted.map { it.kind })
        val nm = ctx.getSystemService(NotificationManager::class.java)
        assertEquals(1, shadowOf(nm).allNotifications.size)
        assertTrue(Notes.check(ctx, save).isEmpty())
    }

    @Test fun silentWithoutPermissionAndRetriesLater() {
        shadowOf(ctx as Application).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val save = GameSave(ctx) { now }
        assertTrue(Notes.check(ctx, save).isEmpty())
        shadowOf(ctx as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        assertEquals(1, Notes.check(ctx, save).size)
    }
}
