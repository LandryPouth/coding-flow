We need to track which vendor each expense came from, starting with the vendors
themselves.

Add a vendor resource: a vendor has a name and a country. People need to list
them, create one, and edit an existing one, through the same router the rest of
the app uses. Two vendors cannot share a name. A vendor with a blank name or no
country is refused, the same way a bad expense is.

Add the tests that protect it.
