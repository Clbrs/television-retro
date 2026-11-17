package com.clbrs.televisionretro;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.regex.Pattern;

/**
 * Envoltorio de Android TV para Televisión Retro: abre la web publicada en pantalla completa
 * y no deja salir de ella. Lo único que añade a la web es mantener la pantalla encendida
 * mientras hay un capítulo sonando y que el botón «atrás» del mando vuelva al menú.
 */
public class MainActivity extends Activity {

    private static final String ORIGEN = "https://clbrs.github.io";
    private static final String RUTA = "/television-retro/";
    private static final String INICIO = ORIGEN + RUTA + "?tv=1";
    // Mismo formato que acepta la web (app.js, FORMATO_CLAVE).
    private static final Pattern FORMATO_CLAVE = Pattern.compile("^[A-Za-z0-9]{20,128}$");

    private WebView web;

    @Override
    protected void onCreate(Bundle guardado) {
        super.onCreate(guardado);
        getWindow().getDecorView().setBackgroundColor(Color.BLACK);

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSafeBrowsingEnabled(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                return !permitida(r.getUrl());   // true = bloqueada: no se navega a ningún otro sitio
            }
            // Errores de certificado: se deja el comportamiento por defecto (cancelar).
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public Bitmap getDefaultVideoPoster() {
                // Sin el icono gris de «play» que pone el WebView antes del primer fotograma.
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }
        });
        web.addJavascriptInterface(new Puente(), "TeleTV");

        setContentView(web);
        pantallaCompleta();

        if (guardado != null) web.restoreState(guardado);
        if (guardado == null || web.getUrl() == null) web.loadUrl(direccionInicial(getIntent()));
    }

    /** Solo la propia app publicada, por https. */
    private static boolean permitida(Uri u) {
        return u != null
                && "https".equals(u.getScheme())
                && "clbrs.github.io".equals(u.getHost())
                && u.getPort() == -1
                && u.getPath() != null
                && u.getPath().startsWith(RUTA);
    }

    /** Con «--es clave …» (desde el PC, por adb) se abre la web con la clave para que la guarde. */
    private static String direccionInicial(Intent i) {
        String clave = i == null ? null : i.getStringExtra("clave");
        if (clave != null && FORMATO_CLAVE.matcher(clave).matches()) return INICIO + "#clave=" + clave;
        return INICIO;
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        String clave = i.getStringExtra("clave");
        if (clave != null && FORMATO_CLAVE.matcher(clave).matches()) web.loadUrl(direccionInicial(i));
    }

    private void pantallaCompleta() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    public void onWindowFocusChanged(boolean foco) {
        super.onWindowFocusChanged(foco);
        if (foco) pantallaCompleta();
    }

    /** «Atrás» en un canal vuelve al menú; en el menú sale de la app. */
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (e.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() == KeyEvent.ACTION_UP) {
                web.evaluateJavascript("window.atrasTV ? atrasTV() === true : false", r -> {
                    if (!"true".equals(r)) finish();
                });
            }
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    @Override
    protected void onSaveInstanceState(Bundle b) {
        super.onSaveInstanceState(b);
        web.saveState(b);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        // La web guarda la posición al ocultarse (visibilitychange) y pausa el vídeo.
        web.onPause();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        web.removeJavascriptInterface("TeleTV");
        web.destroy();
        super.onDestroy();
    }

    /** Lo único que ve la web de Android: encender o apagar el «no apagar pantalla». */
    private final class Puente {
        @JavascriptInterface
        public void pantallaEncendida(final boolean si) {
            runOnUiThread(() -> {
                if (si) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
    }
}
