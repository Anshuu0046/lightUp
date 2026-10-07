; Runs inside the installer (which is elevated) to add and remove the Light Up Camera device.
!macro customInstall
  DetailPrint "Adding Light Up Camera to Windows..."
  nsExec::ExecToLog '"$INSTDIR\resources\lightup_setup.exe" install'
!macroend

!macro customUnInstall
  DetailPrint "Removing Light Up Camera from Windows..."
  nsExec::ExecToLog '"$INSTDIR\resources\lightup_setup.exe" remove'
!macroend
